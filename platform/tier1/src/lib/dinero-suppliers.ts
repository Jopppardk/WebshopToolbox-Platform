export type DineroSupplier = { id: string; name: string; country: string; vatNumber: string };
export type SupplierSnapshot = { suppliers: DineroSupplier[]; fetchedAt: string };
export function supplierContact(raw: Record<string, unknown>): DineroSupplier | null {
  const creditor = raw.IsCreditor ?? raw.isCreditor;
  if (typeof creditor !== 'boolean') throw Error('Dinero returnerede ikke leverandørmarkeringen.');
  if (!creditor || (raw.DeletedAt ?? raw.deletedAt)) return null;
  const id = raw.ContactGuid ?? raw.contactGuid, name = raw.Name ?? raw.name;
  const country = raw.CountryKey ?? raw.countryKey ?? '', vat = raw.VatNumber ?? raw.vatNumber ?? '';
  if (typeof id !== 'string' || !/^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i.test(id) || typeof name !== 'string' || !name.trim() || typeof country !== 'string' || typeof vat !== 'string') throw Error('Dinero returnerede ugyldige leverandøroplysninger.');
  return { id, name: name.trim(), country: country.trim().toUpperCase(), vatNumber: vat.trim() };
}
