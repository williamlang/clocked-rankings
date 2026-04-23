import { gql } from '../src/wcl/client.js'

for (const typeName of ['GuildAttendance', 'GuildTag']) {
  const schema = await gql<{ __type: { fields: Array<{ name: string; description: string | null; type: { name: string | null; kind: string; ofType?: { name: string } } }> } | null }>(
    `query($t: String!) { __type(name: $t) { fields { name description type { name kind ofType { name } } } } }`,
    { t: typeName },
  )
  if (!schema.__type) {
    console.log(`${typeName}: not found`)
    continue
  }
  console.log(`\n${typeName}:`)
  for (const f of schema.__type.fields) {
    const t = f.type.name ?? f.type.ofType?.name ?? f.type.kind
    console.log(`  ${f.name.padEnd(30)} ${t?.padEnd(20)} ${f.description ?? ''}`)
  }
}

// Also pull a real guild to see what 'description' actually contains
console.log('\nSample guild Elitist Jerks description:')
const sample = await gql<{ guildData: { guild: { description: string; tags?: Array<{ id: number; name: string }> } } }>(
  `query { guildData { guild(id: 160) { description tags { id name } } } }`,
  {},
)
console.log('description:', JSON.stringify(sample.guildData.guild.description))
console.log('tags:', sample.guildData.guild.tags)
