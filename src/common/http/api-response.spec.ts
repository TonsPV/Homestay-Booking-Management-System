import { ApiResponse, isApiResponsePayload } from './api-response';

describe('ApiResponse', () => {
  it('creates success payloads with stable default messages', () => {
    expect(ApiResponse.ok({ id: '1' })).toEqual({
      data: { id: '1' },
      message: 'Thanh cong.',
      meta: undefined,
      __apiResponsePayload: true,
    });
    expect(ApiResponse.created({ id: '2' })).toMatchObject({
      data: { id: '2' },
      message: 'Tao moi thanh cong.',
    });
    expect(ApiResponse.message('Da xoa.')).toMatchObject({
      data: null,
      message: 'Da xoa.',
    });
  });

  it('recognizes only explicitly branded payloads', () => {
    expect(isApiResponsePayload(ApiResponse.ok(null))).toBe(true);
    expect(isApiResponsePayload(null)).toBe(false);
    expect(isApiResponsePayload('value')).toBe(false);
    expect(isApiResponsePayload({ data: null })).toBe(false);
    expect(
      isApiResponsePayload({ data: null, __apiResponsePayload: false }),
    ).toBe(false);
  });
});
