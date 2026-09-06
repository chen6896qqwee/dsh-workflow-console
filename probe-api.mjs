// Check repo default branch + test write permission via clean Node fetch.
const token = process.env.GH_TOKEN
const repo = process.argv[2] || 'chen6896qqwee/dsh-workflow-console'
async function api(method, path, body) {
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`, 'User-Agent': 'dwc-check',
      'Content-Type': 'application/json', Accept: 'application/vnd.github+json',
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let json = null; try { json = text ? JSON.parse(text) : null } catch {}
  return { status: res.status, json, text }
}
const r = await api('GET', `/repos/${repo}`)
console.log('repo status:', r.status, '| default_branch:', r.json?.default_branch, '| empty:', r.json?.size === 0)
if (r.json?.default_branch) {
  const ref = await api('GET', `/git/ref/heads/${r.json.default_branch}`)
  console.log('default branch ref:', ref.status, ref.json?.object?.sha || ref.text.slice(0, 80))
}
// write test: create annex-like tiny file via contents API on default branch
const db = r.json?.default_branch || 'main'
const payload = { message: 'dwc write-probe', content: Buffer.from('ping').toString('base64') }
const w = await api('PUT', `/repos/${repo}/contents/.dwc-write-probe`, payload)
console.log('contents write probe:', w.status)
if (!w.ok) console.log('  body:', w.text.slice(0, 200))
else console.log('  wrote:', w.json?.content?.path)