import { SORT_SLUGS } from "lib/constants";
import { z } from "zod";

// Next hands a page `searchParams` where every key is `string | string[] |
// undefined`, and the whole object is absent when the shell renders without
// them. A repeated `?sort=` therefore arrives as an array, which no comparison
// against a slug can ever match — so the URL is parsed here instead of being
// asserted into shape at each page.
const searchParams = z.object({
  q: z.string().optional().catch(undefined),
  sort: z.enum(SORT_SLUGS).nullable().catch(null),
});

export type SearchParams = z.infer<typeof searchParams>;

export function parseSearchParams(
  raw: Record<string, string | string[] | undefined> | undefined,
): SearchParams {
  return searchParams.parse(raw ?? {});
}
