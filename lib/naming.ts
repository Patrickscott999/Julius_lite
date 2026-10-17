/** `Monthly Revenue.csv` → `df_monthly_revenue` (valid Python identifier). Shared by upload + chat. */
export function makeVarName(name: string): string {
  const stem = name
    .toLowerCase()
    .replace(/\.csv.?$/i, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 30);
  return `df_${stem || "dataset"}`;
}