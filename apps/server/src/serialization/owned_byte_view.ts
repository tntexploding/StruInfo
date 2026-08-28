import {types as utilityTypes} from 'node:util';

const typedArrayPrototype = Object.getPrototypeOf(
  Uint8Array.prototype,
) as object;
const typedArrayBufferDescriptor = Object.getOwnPropertyDescriptor(
  typedArrayPrototype,
  'buffer',
);
const typedArrayByteOffsetDescriptor = Object.getOwnPropertyDescriptor(
  typedArrayPrototype,
  'byteOffset',
);
const typedArrayByteLengthDescriptor = Object.getOwnPropertyDescriptor(
  typedArrayPrototype,
  'byteLength',
);

export type OwnedByteViewErrorCode =
  'input_invalid' | 'limit_invalid' | 'input_too_large';

export class OwnedByteViewError extends Error {
  public readonly code: OwnedByteViewErrorCode;

  public constructor(code: OwnedByteViewErrorCode, message: string) {
    super(message);
    this.name = 'OwnedByteViewError';
    this.code = code;
  }
}

export function copyOwnedByteView(
  input: Uint8Array,
  maximumBytes: number,
): Uint8Array {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 0) {
    throw new OwnedByteViewError(
      'limit_invalid',
      'The byte-view limit must be a non-negative safe integer.',
    );
  }
  if (
    !utilityTypes.isUint8Array(input) ||
    typedArrayBufferDescriptor?.get === undefined ||
    typedArrayByteOffsetDescriptor?.get === undefined ||
    typedArrayByteLengthDescriptor?.get === undefined
  ) {
    throw invalidByteView();
  }

  let backingBuffer: ArrayBufferLike;
  let byteOffset: number;
  let byteLength: number;
  try {
    backingBuffer = typedArrayBufferDescriptor.get.call(
      input,
    ) as ArrayBufferLike;
    byteOffset = typedArrayByteOffsetDescriptor.get.call(input) as number;
    byteLength = typedArrayByteLengthDescriptor.get.call(input) as number;
  } catch {
    throw invalidByteView();
  }
  if (
    utilityTypes.isSharedArrayBuffer(backingBuffer) ||
    !utilityTypes.isArrayBuffer(backingBuffer)
  ) {
    throw invalidByteView();
  }

  let ownedBytes: Uint8Array;
  try {
    ownedBytes = Uint8Array.from(
      new Uint8Array(backingBuffer, byteOffset, byteLength),
    );
  } catch {
    throw invalidByteView();
  }
  if (ownedBytes.byteLength > maximumBytes) {
    throw new OwnedByteViewError(
      'input_too_large',
      'The byte view exceeds the configured byte limit.',
    );
  }
  return ownedBytes;
}

function invalidByteView(): OwnedByteViewError {
  return new OwnedByteViewError(
    'input_invalid',
    'Input must be an ordinary, non-shared Uint8Array byte view.',
  );
}
