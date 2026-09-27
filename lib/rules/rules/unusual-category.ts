import type { InvoiceContext, Reason } from "../types";

export default function unusualCategoryRule(ctx: InvoiceContext): Reason | null {
  if (ctx.subsidiaryApprovedCategories.includes(ctx.invoice.category)) return null;
  return {
    code: "UNUSUAL_CATEGORY",
    level: "orange",
    message: `Catégorie inhabituelle pour la filiale : ${ctx.invoice.category}`,
    data: { category: ctx.invoice.category, knownCategories: ctx.subsidiaryApprovedCategories },
  };
}
