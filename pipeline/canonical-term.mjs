export function canonicalTerm(name, aliases) {
  const seen = new Map();
  const path = [];
  while (aliases.has(name)) {
    if (seen.has(name)) return path.slice(seen.get(name)).sort()[0];
    seen.set(name, path.length);
    path.push(name);
    name = aliases.get(name);
  }
  return name;
}
