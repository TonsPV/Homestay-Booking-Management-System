import { createPaginationMeta } from '../../../../src/common/pagination/pagination.types';

describe('createPaginationMeta', () => {
  it.each([
    [1, 20, 0, 0],
    [1, 20, 7, 1],
    [1, 20, 20, 1],
    [1, 20, 21, 2],
    [3, 10, 25, 3],
  ])(
    'returns canonical metadata for page %s, limit %s, total %s',
    (page, limit, total, totalPages) => {
      expect(createPaginationMeta(page, limit, total)).toEqual({
        pagination: { page, limit, total, totalPages },
      });
    },
  );
});
