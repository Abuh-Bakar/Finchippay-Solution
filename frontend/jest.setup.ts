import "@testing-library/jest-dom";
import { toHaveNoViolations } from "jest-axe";
import { TextDecoder, TextEncoder } from "util";

expect.extend(toHaveNoViolations);

Object.assign(global, {
  TextEncoder,
  TextDecoder,
});
