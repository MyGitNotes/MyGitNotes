import YAML from 'yaml';

// Keep the YAML 1.2 core schema, but quote text that a YAML 1.1 reader would resolve
// to another type (e.g. dates, sexagesimal numbers, or yes/no). No version directive
// is needed, and real numbers, booleans and null still use their native YAML types.
const yaml11 = new YAML.Schema({ schema: 'yaml-1.1' }).tags;
// js-yaml's default schema also resolves signed 0o octals and some timestamp forms
// outside yaml's matchers (e.g. a bare fractional dot or a two-digit offset past 29).
const jsYamlScalar: YAML.ScalarTag = {
  tag: '!js-yaml-scalar',
  default: true,
  test: /^(?:[-+]0o[0-7]+|\d{4}-\d{1,2}-\d{1,2}(?:[Tt]|[ \t]+)\d{1,2}:\d{2}:\d{2}(?:\.\d*)?(?:[ \t]*(?:Z|[-+]\d{1,2}(?::\d{2})?))?)$/,
  resolve: value => value, // Compatibility checks only test the pattern; they never resolve it.
};
export const frontmatterYamlOptions = { compat: [...yaml11, jsYamlScalar] };

export function createFrontmatterDocument(value: unknown): YAML.Document {
  return new YAML.Document(value, frontmatterYamlOptions);
}

export function stringifyFrontmatterYaml(value: unknown, options?: YAML.ToStringOptions): string {
  return createFrontmatterDocument(value).toString(options);
}
