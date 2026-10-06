// Feed links read /feeds/<webshop folder>/<file name>.xml: lowercase letters, digits and dashes.
export const feedFileNamePattern = /^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$/;
export function slugify(value: string, max = 60) {
  return value
    .toLocaleLowerCase('da')
    .replaceAll('æ', 'ae')
    .replaceAll('ø', 'oe')
    .replaceAll('å', 'aa')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/, '');
}
