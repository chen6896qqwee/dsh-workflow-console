// Push local repo files to GitHub via Contents API (api.github.com),
// one PUT per file on the target branch. Requires Contents: Read&Write.
// Token from GH_TOKEN env (set by caller). Use with 'path must be inside repo'.
// Since each PUT commits, do a single commit per file; to keep history clean
// we just commit each file (acceptable for first import) and note SHAs.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const repo = process.argv[2]
const branch = process.argv[3] || 'main'
const token = process.env.GH_TOKEN
if (!token) { console.error('GH_TOKEN env required'); process.exit(2) }

const SKIP_DIRS = new Set(['node_modules', '.git', 'src', 'dist'])
const root = process.cwd()
function* walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) yield* walk(p)
    else {
      const rel = relative(root, p).split(sep).join('/')
      if (!rel.endsWith('.map')) yield rel
    }
  }
}

async function getRef() {
  const r = await fetch(`https://api.github.com/git/ref/heads/${branch}`, {
    headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'dwc', Accept: 'application/vnd.github+json' },
  })
  if (r.status === 404) return null
  const j = await r.json()
  return r.ok ? j.object.sha : null
}

async function put(rel, content) {
  const body = { message: `add ${rel}`, content: content.toString('base64'), branch }
  const res = await fetch(`https://api.github.com/repos/${repo}/contents/${rel}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'dwc', 'Content-Type': 'application/json', Accept: 'application/vnd.github+json' },
    body: JSON.stringify(body),
  })
  return { status: res.status, json: res.ok ? await res.json() : await res.text() }
}

async function run() {
  // If repo empty (no default branch ref), the first contents PUT on branch
  // will create the branch automatically.
  const files = [...walk(root)].sort()
  console.error('files to push:', files.length)
  const tip = await getRef()
  console.error('current tip:', tip || '(empty — branch will be created by first PUT)')
  const results = []
  for (const rel of files) {
    const content = readFileSync(join(root, rel.split('/').join(sep)))
    const r = await put(rel, content)
    if (r.status >= 300) {
      // If a file already exists with same content, GitHub returns 422 — treat as skip if identical
      console.error(`put ${rel}: ${r.status} ${typeof r.json === 'string' ? r.json.slice(0, 160) : 'ok'}`)
      results.push({ rel, status: r.status })
      if (r.status === 404) { console.error('  token lacks Contents write? aborting'); process.exit(1) }
    } else {
      results.push({ rel, status: r.status, sha: r.json?.content?.sha })
      console.error(`put ${rel}: ${r.status}`)
    }
  }
  const tip2 = await getRef()
  console.log(JSON.stringify({ repo, branch, files: files.length, lastTip: tip2, results }, null, 2))
}

run().catch((e) => { console.error('FATAL', e.message); process.exit(1) })