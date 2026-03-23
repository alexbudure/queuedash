export type JSONEditorRootType = "any" | "object" | "array";

export type JSONEditorValidationState = {
  isValid: boolean;
  errorMessage: string | null;
  normalizedValue?: string;
  parsedValue?: unknown;
};

type NormalizeJSONEditorValueOptions = {
  value: string;
  label: string;
  required?: boolean;
  rootType?: JSONEditorRootType;
};

class JSONishSyntaxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JSONishSyntaxError";
  }
}

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const getRootTypeError = (
  rootType: Exclude<JSONEditorRootType, "any">,
  label: string,
) => {
  if (rootType === "array") {
    return `${label} must be a JSON array.`;
  }

  return `${label} must be a JSON object.`;
};

const validResult = (
  normalizedValue: string | undefined,
  parsedValue: unknown,
): JSONEditorValidationState => {
  return {
    isValid: true,
    errorMessage: null,
    normalizedValue,
    parsedValue,
  };
};

const invalidResult = (errorMessage: string): JSONEditorValidationState => {
  return {
    isValid: false,
    errorMessage,
  };
};

const setObjectProperty = (
  value: Record<string, unknown>,
  key: string,
  propertyValue: unknown,
) => {
  Object.defineProperty(value, key, {
    value: propertyValue,
    enumerable: true,
    configurable: true,
    writable: true,
  });
};

class JSONishParser {
  private index = 0;

  constructor(private readonly input: string) {}

  parse(): unknown {
    const value = this.parseValue();
    this.skipWhitespace();

    if (!this.isAtEnd()) {
      throw new JSONishSyntaxError("Unexpected token after the end of input.");
    }

    return value;
  }

  private parseValue(): unknown {
    this.skipWhitespace();

    const char = this.peek();

    if (!char) {
      throw new JSONishSyntaxError("Expected a JSON value.");
    }

    if (char === "{") {
      return this.parseObject();
    }

    if (char === "[") {
      return this.parseArray();
    }

    if (char === '"' || char === "'") {
      return this.parseString(char);
    }

    if (char === "-" || this.isDigit(char)) {
      return this.parseNumber();
    }

    if (char === "/") {
      throw new JSONishSyntaxError("Comments are not supported.");
    }

    if (char === "`") {
      throw new JSONishSyntaxError("Template literals are not supported.");
    }

    if (this.input.slice(this.index, this.index + 3) === "...") {
      throw new JSONishSyntaxError("Spread syntax is not supported.");
    }

    if (this.isIdentifierStart(char)) {
      const identifier = this.parseIdentifier();

      if (identifier === "true") {
        return true;
      }

      if (identifier === "false") {
        return false;
      }

      if (identifier === "null") {
        return null;
      }

      throw new JSONishSyntaxError(
        `"${identifier}" is not supported. Use a JSON value instead.`,
      );
    }

    throw new JSONishSyntaxError(`Unexpected token "${char}".`);
  }

  private parseObject(): Record<string, unknown> {
    this.consume("{");
    this.skipWhitespace();

    const value: Record<string, unknown> = {};

    if (this.peek() === "}") {
      this.consume("}");
      return value;
    }

    while (!this.isAtEnd()) {
      const key = this.parseObjectKey();
      this.skipWhitespace();
      this.consume(":");
      setObjectProperty(value, key, this.parseValue());
      this.skipWhitespace();

      if (this.peek() === ",") {
        this.consume(",");
        this.skipWhitespace();

        if (this.peek() === "}") {
          this.consume("}");
          return value;
        }

        continue;
      }

      if (this.peek() === "}") {
        this.consume("}");
        return value;
      }

      throw new JSONishSyntaxError('Expected "," or "}" in object literal.');
    }

    throw new JSONishSyntaxError("Unterminated object literal.");
  }

  private parseArray(): unknown[] {
    this.consume("[");
    this.skipWhitespace();

    const value: unknown[] = [];

    if (this.peek() === "]") {
      this.consume("]");
      return value;
    }

    while (!this.isAtEnd()) {
      value.push(this.parseValue());
      this.skipWhitespace();

      if (this.peek() === ",") {
        this.consume(",");
        this.skipWhitespace();

        if (this.peek() === "]") {
          this.consume("]");
          return value;
        }

        continue;
      }

      if (this.peek() === "]") {
        this.consume("]");
        return value;
      }

      throw new JSONishSyntaxError('Expected "," or "]" in array literal.');
    }

    throw new JSONishSyntaxError("Unterminated array literal.");
  }

  private parseObjectKey(): string {
    this.skipWhitespace();

    const char = this.peek();

    if (!char) {
      throw new JSONishSyntaxError("Expected an object key.");
    }

    if (char === '"' || char === "'") {
      return this.parseString(char);
    }

    if (char === "[") {
      throw new JSONishSyntaxError("Computed keys are not supported.");
    }

    if (char === "/") {
      throw new JSONishSyntaxError("Comments are not supported.");
    }

    if (char === "`") {
      throw new JSONishSyntaxError("Template literals are not supported.");
    }

    if (!this.isIdentifierStart(char)) {
      throw new JSONishSyntaxError("Expected a quoted string or bare key.");
    }

    return this.parseIdentifier();
  }

  private parseString(quote: '"' | "'"): string {
    this.consume(quote);

    let result = "";

    while (!this.isAtEnd()) {
      const char = this.consumeCharacter();

      if (char === quote) {
        return result;
      }

      if (char === "\n" || char === "\r") {
        throw new JSONishSyntaxError("Unterminated string literal.");
      }

      if (char === "\\") {
        result += this.parseEscapeSequence();
        continue;
      }

      result += char;
    }

    throw new JSONishSyntaxError("Unterminated string literal.");
  }

  private parseEscapeSequence(): string {
    const escape = this.consumeCharacter();

    switch (escape) {
      case '"':
      case "'":
      case "\\":
      case "/":
        return escape;
      case "b":
        return "\b";
      case "f":
        return "\f";
      case "n":
        return "\n";
      case "r":
        return "\r";
      case "t":
        return "\t";
      case "u":
        return this.parseUnicodeEscape(4);
      case "x":
        return this.parseUnicodeEscape(2);
      default:
        throw new JSONishSyntaxError(
          `Unsupported escape sequence "\\${escape}".`,
        );
    }
  }

  private parseUnicodeEscape(length: number): string {
    const digits = this.input.slice(this.index, this.index + length);

    if (!new RegExp(`^[0-9a-fA-F]{${length}}$`).test(digits)) {
      throw new JSONishSyntaxError("Invalid unicode escape sequence.");
    }

    this.index += length;
    return String.fromCharCode(parseInt(digits, 16));
  }

  private parseNumber(): number {
    const remainingInput = this.input.slice(this.index);
    const numberMatch = remainingInput.match(
      /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/,
    );

    if (!numberMatch) {
      throw new JSONishSyntaxError("Invalid number value.");
    }

    const value = Number(numberMatch[0]);

    if (!Number.isFinite(value)) {
      throw new JSONishSyntaxError("Only finite JSON numbers are supported.");
    }

    this.index += numberMatch[0].length;
    return value;
  }

  private parseIdentifier(): string {
    const startIndex = this.index;
    this.consumeCharacter();

    while (this.isIdentifierPart(this.peek())) {
      this.consumeCharacter();
    }

    return this.input.slice(startIndex, this.index);
  }

  private skipWhitespace() {
    while (!this.isAtEnd() && /\s/.test(this.peek() || "")) {
      this.index += 1;
    }
  }

  private consume(expected: string) {
    if (this.peek() !== expected) {
      throw new JSONishSyntaxError(`Expected "${expected}".`);
    }

    this.index += expected.length;
  }

  private consumeCharacter(): string {
    const char = this.peek();

    if (!char) {
      throw new JSONishSyntaxError("Unexpected end of input.");
    }

    this.index += 1;
    return char;
  }

  private peek() {
    return this.input[this.index];
  }

  private isAtEnd() {
    return this.index >= this.input.length;
  }

  private isDigit(char?: string) {
    return !!char && char >= "0" && char <= "9";
  }

  private isIdentifierStart(char?: string) {
    return !!char && /[A-Za-z_$]/.test(char);
  }

  private isIdentifierPart(char?: string) {
    return !!char && /[A-Za-z0-9_$]/.test(char);
  }
}

const parseJSONishValue = (value: string) => {
  const trimmedValue = value.trim();

  try {
    return JSON.parse(trimmedValue) as unknown;
  } catch {
    return new JSONishParser(trimmedValue).parse();
  }
};

export const normalizeJSONEditorValue = ({
  value,
  label,
  required = false,
  rootType = "any",
}: NormalizeJSONEditorValueOptions): JSONEditorValidationState => {
  const trimmedValue = value.trim();

  if (!trimmedValue) {
    if (required) {
      return invalidResult(`${label} is required.`);
    }

    return validResult(undefined, undefined);
  }

  let parsedValue: unknown;

  try {
    parsedValue = parseJSONishValue(trimmedValue);
  } catch (error) {
    if (error instanceof JSONishSyntaxError) {
      return invalidResult(error.message);
    }

    return invalidResult(`Unable to parse ${label.toLowerCase()}.`);
  }

  if (rootType === "object" && !isPlainObject(parsedValue)) {
    return invalidResult(getRootTypeError("object", label));
  }

  if (rootType === "array" && !Array.isArray(parsedValue)) {
    return invalidResult(getRootTypeError("array", label));
  }

  return validResult(JSON.stringify(parsedValue, null, 2), parsedValue);
};
