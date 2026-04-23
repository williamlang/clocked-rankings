import { gql } from '../src/wcl/client.js'

// Introspection query for the Guild type's fields
const schema = await gql<{ __type: { fields: Array<{ name: string; description: string | null; type: { name: string | null; kind: string } }> } }>(
  `query { __type(name: "Guild") { fields { name description type { name kind } } } }`,
  {},
)
console.log('Guild type fields:')
for (const f of schema.__type.fields) {
  console.log(`  ${f.name.padEnd(30)} ${f.type.name ?? f.type.kind}  ${f.description ?? ''}`)
}
