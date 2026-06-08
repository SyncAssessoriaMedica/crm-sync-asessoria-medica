const DEFAULT_PAGE_SIZE = 1000;

type PaginatedQuery<T> = {
  range: (from: number, to: number) => PromiseLike<{
    data: T[] | null;
    error: { message: string } | null;
  }>;
};

export async function fetchAllRows<T>(
  buildQuery: () => PaginatedQuery<T>,
  pageSize = DEFAULT_PAGE_SIZE
): Promise<{ data: T[]; error: { message: string } | null }> {
  const data: T[] = [];
  let from = 0;

  while (true) {
    const to = from + pageSize - 1;
    const result = await buildQuery().range(from, to);

    if (result.error) return { data, error: result.error };

    const page = result.data ?? [];
    data.push(...page);

    if (page.length < pageSize) return { data, error: null };
    from += pageSize;
  }
}
