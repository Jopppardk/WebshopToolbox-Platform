// Emballage → Varer: which products have a packaging weight and reportability, and editing them.
// The only Shopify write is metafieldsSet for custom.emballage_vaegt_gram and custom.emballage_indberetning
// on the chosen product. Delivery lines still waiting for these values are updated with them; lines that
// were already complete keep the values they were registered with.
import { requireCompany } from './auth';
import { jsonBody } from './invitations';
import { orderQuery, shopAccess } from './invoice-source';
import { normalizeReportable } from './packaging-calculations';
import { productionWrites } from './production-policy';
import { HttpError, reply, type Actor, type PlatformEnv } from './types';

type Node = {
  id: string;
  title: string;
  status: string;
  weight: { value: string } | null;
  reportable: { value: string } | null;
};
const productId = /^gid:\/\/shopify\/Product\/\d{1,30}$/;
// A line waits for product data while it has no weight, or a weight above 0 without reportability.
// A weight of 0 grams is an approved product without packaging.
const openLine =
  "(json_extract(payload_json,'$.weightGrams') IS NULL OR (json_extract(payload_json,'$.weightGrams')>0 AND json_extract(payload_json,'$.reportable') NOT IN ('yes','no')))";

function weightOf(node: Node) {
  const raw = node.weight?.value;
  if (raw === undefined || raw === null || raw === '') return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

export async function handlePackagingProducts(
  request: Request,
  env: PlatformEnv,
  actor: Actor,
  company: string,
  shop: string,
) {
  if (shop === 'none') throw new HttpError(409, 'Forbind en webshop først.');
  const db = env.PLATFORM_DB;
  if (request.method === 'GET') {
    const access = await shopAccess(env, company, shop);
    const products: Node[] = [];
    let after: string | null = null;
    for (let page = 0; ; page++) {
      if (page >= 20)
        throw new HttpError(
          409,
          'Webshoppen har flere end 5.000 aktive produkter. Kontakt support for en større oversigt.',
        );
      const data: {
        products: {
          nodes: Node[];
          pageInfo: { hasNextPage: boolean; endCursor: string | null };
        };
      } = await orderQuery(
        access,
        'query PackagingProductList($after:String){products(first:250,after:$after,query:"status:active OR status:draft",sortKey:TITLE){nodes{id title status weight:metafield(namespace:"custom",key:"emballage_vaegt_gram"){value} reportable:metafield(namespace:"custom",key:"emballage_indberetning"){value}} pageInfo{hasNextPage endCursor}}}',
        { after },
        'Shopify kunne ikke hente produkterne. Kontrollér Shopify-appens adgang til produkter.',
      );
      const connection = data.products;
      if (
        !Array.isArray(connection?.nodes) ||
        typeof connection.pageInfo?.hasNextPage !== 'boolean'
      )
        throw new HttpError(
          409,
          'Shopify returnerede en ufuldstændig produktliste.',
        );
      for (const node of connection.nodes)
        if (!productId.test(node.id) || typeof node.title !== 'string')
          throw new HttpError(409, 'Shopify returnerede et ugyldigt produkt.');
      products.push(...connection.nodes);
      if (!connection.pageInfo.hasNextPage) break;
      if (
        !connection.pageInfo.endCursor ||
        connection.pageInfo.endCursor === after
      )
        throw new HttpError(
          409,
          'Shopify stoppede under hentning af produkterne.',
        );
      after = connection.pageInfo.endCursor;
    }
    const scopes = await orderQuery<{
      currentAppInstallation: { accessScopes: Array<{ handle: string }> };
    }>(
      access,
      'query PackagingProductScopes{currentAppInstallation{accessScopes{handle}}}',
      {},
    );
    const open = new Map(
      (
        await db
          .prepare(
            `SELECT json_extract(payload_json,'$.productId') product,count(*) n FROM packaging_snapshots WHERE company_id=? AND webshop_id=? AND ${openLine} GROUP BY product`,
          )
          .bind(company, shop)
          .all<{ product: string; n: number }>()
      ).results.map((r) => [r.product, r.n]),
    );
    return reply({
      writes: productionWrites(env),
      canWrite: !!scopes.currentAppInstallation?.accessScopes?.some(
        (s) => s.handle === 'write_products',
      ),
      products: products.map((node) => ({
        id: node.id,
        title: node.title,
        status: node.status,
        weightGrams: weightOf(node),
        reportable: normalizeReportable(node.reportable?.value),
        openLines: open.get(node.id) || 0,
      })),
    });
  }
  if (request.method !== 'POST') throw new HttpError(405, 'Brug Gem.');
  await requireCompany(db, actor, company, true);
  if (actor.support)
    throw new HttpError(403, 'Afslut supportadgang før ændringer i Shopify.');
  const b = await jsonBody(request);
  if (typeof b.productId !== 'string' || !productId.test(b.productId))
    throw new HttpError(400, 'Vælg et produkt.');
  const weight = Number.isSafeInteger(b.weightGrams)
    ? (b.weightGrams as number)
    : -1;
  if (weight < 0 || weight > 100000)
    throw new HttpError(
      400,
      'Angiv emballagevægten i hele gram (0 eller mere). 0 gram betyder, at varen ikke har emballage.',
    );
  const reportable =
    b.reportable === 'yes' || b.reportable === 'no' ? b.reportable : null;
  if (weight > 0 && !reportable)
    throw new HttpError(400, 'Vælg, om emballagen er indberetningspligtig.');
  if (!productionWrites(env))
    throw new HttpError(
      403,
      'Ændringer i Shopify er blokeret i testmiljøet. Brug produktionsportalen.',
    );
  const metafields = [
    {
      ownerId: b.productId,
      namespace: 'custom',
      key: 'emballage_vaegt_gram',
      type: 'number_integer',
      value: String(weight),
    },
    ...(reportable
      ? [
          {
            ownerId: b.productId,
            namespace: 'custom',
            key: 'emballage_indberetning',
            type: 'boolean',
            value: reportable === 'yes' ? 'true' : 'false',
          },
        ]
      : []),
  ];
  // Permissions, input and environment are checked before Shopify is contacted.
  const access = await shopAccess(env, company, shop);
  // Dedicated mutation call: the shared orderQuery helper refuses every mutation by design.
  let response: Response;
  try {
    response = await fetch(
      `https://${access.shop}/admin/api/2026-07/graphql.json`,
      {
        method: 'POST',
        redirect: 'manual',
        signal: AbortSignal.timeout(20000),
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': access.accessToken,
        },
        body: JSON.stringify({
          query:
            'mutation SetPackagingFields($metafields:[MetafieldsSetInput!]!){metafieldsSet(metafields:$metafields){metafields{key value} userErrors{code message}}}',
          variables: { metafields },
        }),
      },
    );
  } catch {
    throw new HttpError(
      503,
      'Shopify kunne ikke kontaktes. Prøv igen om lidt.',
    );
  }
  const result = (await response.json().catch(() => null)) as {
    data?: {
      metafieldsSet?: {
        metafields?: Array<{ key: string }> | null;
        userErrors?: Array<{ code?: string; message: string }>;
      };
    };
    errors?: Array<{ message?: string }>;
  } | null;
  const set = result?.data?.metafieldsSet;
  if (
    response.status === 403 ||
    result?.errors?.some((e) => /access|scope/i.test(e.message || ''))
  )
    throw new HttpError(
      409,
      'Shopify-appen mangler rettigheden write_products. Tilføj den under appens adgang i Shopify, og prøv igen.',
    );
  if (
    !response.ok ||
    result?.errors?.length ||
    !set ||
    set.userErrors?.length ||
    set.metafields?.length !== metafields.length
  )
    throw new HttpError(
      409,
      `Varen kunne ikke opdateres i Shopify. ${set?.userErrors?.[0]?.message || ''}`.trim(),
    );
  const updated = await db
    .prepare(
      `UPDATE packaging_snapshots SET payload_json=json_set(payload_json,'$.weightGrams',?,'$.reportable',COALESCE(?,json_extract(payload_json,'$.reportable')),'$.refreshedAt',?) WHERE company_id=? AND webshop_id=? AND json_extract(payload_json,'$.productId')=? AND ${openLine}`,
    )
    .bind(
      weight,
      reportable,
      new Date().toISOString(),
      company,
      shop,
      b.productId,
    )
    .run();
  await db
    .prepare(
      "INSERT INTO audit_events(id,company_id,actor_id,action,resource_id,details_json) VALUES(?,?,?,'shopify.packaging_product',?,?)",
    )
    .bind(
      crypto.randomUUID(),
      company,
      actor.id,
      b.productId,
      JSON.stringify({ webshopId: shop, weightGrams: weight, reportable }),
    )
    .run();
  return reply({ saved: true, updatedLines: updated.meta.changes || 0 });
}
