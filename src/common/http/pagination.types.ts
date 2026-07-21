export interface PaginationMeta extends Record<string, unknown> {
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}
