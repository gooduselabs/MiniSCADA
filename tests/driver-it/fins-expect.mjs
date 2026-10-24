// Values of the FINS integration tests (feature 018): the Tags of project fins-all-types read through each
// channel, by address, with their type, the value the runtime must show and extra source keys. Shared by
// make-fins-projects.mjs (it writes the map of tools/fins-sim) and fins-it.mjs (it checks the values).
// A trailing space in the key keeps the completion flag of T5 / C12 apart from its present value.
export const EXPECT = {
  D100: ['INT16', -1234],
  D101: ['UINT16', 54321],
  D102: ['INT32', 123456789],
  D104: ['UINT32', 4000000000],
  D106: ['FLOAT32', Math.fround(123.456)],
  D110: ['FLOAT64', 3.141592653589793],
  D120: ['INT64', '72623859790382856'],
  D130: ['STRING', 'Bơm 1', { stringLength: 6 }],
  D140: ['UINT16', 1234, { bcd: true }],
  D141: ['UINT32', 12345678, { bcd: true }],
  'D150.03': ['BOOL', true],
  'D150.04': ['BOOL', false],
  'CIO10.03': ['BOOL', true],
  'W5.00': ['BOOL', true],
  H2: ['UINT16', 777],
  A448: ['UINT16', 4242],
  E0_100: ['UINT32', 70000],
  EC_5: ['INT16', -2],
  T5: ['UINT16', 150],
  'T5 ': ['BOOL', true],
  C12: ['UINT16', 7],
  'C12 ': ['BOOL', false],
};

/** The Tag id of an address of EXPECT for a channel prefix (U: UDP, T: TCP). */
export const idOf = (prefix, address) =>
  `${prefix}.${address.trim().replace('.', '_')}${address.endsWith(' ') ? '_DONE' : ''}`;
