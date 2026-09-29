// Creates the product metafield definitions the packaging module reads (packaging-source.ts).
// The only Shopify write here is metafieldDefinitionCreate for these five keys; it never
// changes products, values or orders, and existing definitions are left untouched.
import { requireCompany } from './auth';
import { jsonBody } from './invitations';
import { orderQuery, shopAccess } from './invoice-source';
import { productionWrites } from './production-policy';
import { HttpError, reply, type Actor, type PlatformEnv } from './types';

export const packagingFields = [
  { key: 'emballage_indberetning', type: 'boolean', name: 'Emballage: indberetningspligtig', description: 'Skal produktets emballage indberettes? Bruges af WebshopToolbox.' },
  { key: 'emballage_vaegt_gram', type: 'number_integer', name: 'Emballage: vægt i gram', description: 'Emballagens vægt pr. solgt enhed i hele gram. Bruges af WebshopToolbox.' },
  { key: 'emballage_leverandor', type: 'single_line_text_field', name: 'Emballage: leverandør', description: 'Navn på emballageleverandøren. Bruges af WebshopToolbox.' },
  { key: 'emballage_leverandorland', type: 'single_line_text_field', name: 'Emballage: leverandørland', description: 'Leverandørens land som landekode, fx DK. Bruges af WebshopToolbox.' },
  { key: 'emballage_leverandor_cvr', type: 'single_line_text_field', name: 'Emballage: leverandørens CVR', description: 'Leverandørens CVR-nummer, hvis dansk. Bruges af WebshopToolbox.' },
] as const;

type Access = Awaited<ReturnType<typeof shopAccess>>;
type Existing = { key: string; type: { name: string } };

async function inspect(access: Access) {
  const data = await orderQuery<{ metafieldDefinitions: { nodes: Existing[] }; currentAppInstallation: { accessScopes: Array<{ handle: string }> } }>(access,
    'query PackagingFieldDefinitions { metafieldDefinitions(first: 100, ownerType: PRODUCT, namespace: "custom") { nodes { key type { name } } } currentAppInstallation { accessScopes { handle } } }', {},
    'Shopify-felterne kunne ikke kontrolleres. Kontrollér Shopify-appens adgang til produkter.');
  if (!Array.isArray(data.metafieldDefinitions?.nodes)) throw new HttpError(409, 'Shopify returnerede ikke feltdefinitionerne.');
  const existing = new Map(data.metafieldDefinitions.nodes.map(node => [node.key, node.type?.name]));
  const canWrite = !!data.currentAppInstallation?.accessScopes?.some(scope => scope.handle === 'write_products');
  const fields = packagingFields.map(field => {
    const type = existing.get(field.key);
    return { key: field.key, name: field.name, type: field.type, status: !type ? 'missing' : type === field.type ? 'present' : 'conflict', existingType: type ?? null };
  });
  return { fields, canWrite };
}

// Dedicated mutation call: the shared orderQuery helper refuses every mutation by design.
async function createDefinition(access: Access, field: (typeof packagingFields)[number]) {
  const query = 'mutation CreatePackagingField($definition: MetafieldDefinitionInput!) { metafieldDefinitionCreate(definition: $definition) { createdDefinition { key } userErrors { code message } } }';
  const definition = { namespace: 'custom', key: field.key, name: field.name, description: field.description, type: field.type, ownerType: 'PRODUCT', pin: true,
    ...(field.type === 'number_integer' ? { validations: [{ name: 'min', value: '0' }] } : {}) };
  let response: Response;
  try {
    response = await fetch(`https://${access.shop}/admin/api/2026-07/graphql.json`, { method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(20000),
      headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': access.accessToken }, body: JSON.stringify({ query, variables: { definition } }) });
  } catch { throw new HttpError(503, 'Shopify kunne ikke kontaktes. Prøv igen om lidt.'); }
  const result = await response.json().catch(() => null) as { data?: { metafieldDefinitionCreate?: { createdDefinition?: { key: string } | null; userErrors?: Array<{ code?: string; message: string }> } }; errors?: unknown[] } | null;
  const created = result?.data?.metafieldDefinitionCreate;
  // TAKEN means the definition appeared meanwhile; the follow-up inspection reports it.
  if (created?.userErrors?.some(error => error.code === 'TAKEN')) return;
  if (!response.ok || result?.errors?.length || !created?.createdDefinition) throw new HttpError(409, `Feltet "${field.name}" kunne ikke oprettes i Shopify. ${created?.userErrors?.[0]?.message || ''}`.trim());
}

export async function handleShopifyFields(request: Request, env: PlatformEnv, actor: Actor, company: string, shop: string) {
  if (shop === 'none') throw new HttpError(409, 'Forbind en webshop først.');
  const access = await shopAccess(env, company, shop);
  if (request.method === 'GET') return reply({ ...await inspect(access), writes: productionWrites(env) });
  if (request.method !== 'POST') throw new HttpError(405, 'Brug Opret felter.');
  await requireCompany(env.PLATFORM_DB, actor, company, true);
  if (actor.support) throw new HttpError(403, 'Afslut supportadgang før ændringer i Shopify.');
  await jsonBody(request);
  if (!productionWrites(env)) throw new HttpError(403, 'Oprettelse af felter i Shopify er blokeret i testmiljøet. Brug produktionsportalen.');
  const before = await inspect(access);
  if (!before.canWrite) throw new HttpError(409, 'Shopify-appen mangler rettigheden write_products. Tilføj den under appens adgang i Shopify, og prøv igen.');
  const missing = packagingFields.filter(field => before.fields.find(f => f.key === field.key)?.status === 'missing');
  for (const field of missing) await createDefinition(access, field);
  const after = await inspect(access);
  await env.PLATFORM_DB.prepare("INSERT INTO audit_events(id,company_id,actor_id,action,resource_id,details_json) VALUES(?,?,?,'shopify.packaging_fields',?,?)")
    .bind(crypto.randomUUID(), company, actor.id, shop, JSON.stringify({ created: missing.map(f => f.key) })).run();
  return reply({ ...after, writes: true, created: missing.map(f => f.key) });
}
