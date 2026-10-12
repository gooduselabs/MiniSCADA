export type TagDataType =
  | 'BOOL'
  | 'INT16'
  | 'UINT16'
  | 'INT32'
  | 'UINT32'
  | 'INT64'
  | 'UINT64'
  | 'FLOAT32'
  | 'FLOAT64'
  | 'STRING';

/** Kiểu số trên thiết bị trường (đọc từ thanh ghi). */
export type NumericType =
  'INT16' | 'UINT16' | 'INT32' | 'UINT32' | 'INT64' | 'UINT64' | 'FLOAT32' | 'FLOAT64';

/** ABCD chuẩn Modbus; CDAB đảo word; BADC đảo byte trong từng word; DCBA đảo cả hai. */
export type ByteOrder = 'ABCD' | 'CDAB' | 'BADC' | 'DCBA';

export type StringByteOrder = 'AB' | 'BA';
