# Hook PostToolUse (matcher Bash). Si el comando ejecutado fue `gh pr create` o `git push`
# en un branch que NO es la base, inyecta a Claude la orden de correr /review-loop sobre el
# diff del branch. Deduplica por SHA en .git/review-loop-state.json para no disparar dos
# veces sobre el mismo commit. Cualquier camino que no aplique termina en exit 0 silencioso.
$ErrorActionPreference = "SilentlyContinue"

# 1. Leer el evento del hook por stdin
$raw = [Console]::In.ReadToEnd()
if (-not $raw) { exit 0 }
try { $evt = $raw | ConvertFrom-Json } catch { exit 0 }
$cmd = $evt.tool_input.command
if (-not $cmd) { exit 0 }

# 2. Filtrar: gh pr create / git push / git commit
$isPr     = $cmd -match '\bgh\s+pr\s+create\b'
$isPush   = $cmd -match '\bgit\s+push\b'
$isCommit = $cmd -match '\bgit\s+commit(?![\w-])'   # excluye git commit-graph y similares
if (-not ($isPr -or $isPush -or $isCommit)) { exit 0 }

# 3. Ubicarse en el repo (cwd del evento)
$cwd = if ($evt.cwd) { $evt.cwd } else { (Get-Location).Path }
Set-Location -LiteralPath $cwd
$gitDir = (git rev-parse --git-dir 2>$null)
if (-not $gitDir) { exit 0 }                 # no es repo git
if (-not [System.IO.Path]::IsPathRooted($gitDir)) { $gitDir = Join-Path $cwd $gitDir }
$branch = (git rev-parse --abbrev-ref HEAD 2>$null)
if (-not $branch -or $branch -eq "HEAD") { exit 0 }

# 4. Resolver la base branch (NO hardcodear main)
$base = $null
if ($isPr -and $cmd -match '--base[ =]+([^\s''"]+)') { $base = $matches[1] }
if (-not $base) {
    $head = (git symbolic-ref --short refs/remotes/origin/HEAD 2>$null)
    if ($head) { $base = ($head -replace '^origin/', '') }
}
if (-not $base) {
    $def = (gh repo view --json defaultBranchRef -q .defaultBranchRef.name 2>$null)
    if ($def) { $base = $def.Trim() }
}
if (-not $base) {
    foreach ($cand in @("main", "master", "develop")) {
        git rev-parse --verify --quiet "$cand" 2>$null | Out-Null
        if ($LASTEXITCODE -eq 0) { $base = $cand; break }
    }
}
if (-not $base) { exit 0 }

# 5. No revisar la base contra sí misma
if ($branch -eq $base) { exit 0 }

# 6. Dedupe por SHA del HEAD del branch
$sha = (git rev-parse HEAD 2>$null)
if (-not $sha) { exit 0 }
$statePath = Join-Path $gitDir "review-loop-state.json"
$state = @{}
if (Test-Path $statePath) {
    try {
        (Get-Content $statePath -Raw | ConvertFrom-Json).PSObject.Properties |
            ForEach-Object { $state[$_.Name] = $_.Value }
    } catch { $state = @{} }
}
if ($state[$branch] -eq $sha) { exit 0 }     # ya disparado para este commit
$state[$branch] = $sha
([pscustomobject]$state) | ConvertTo-Json | Set-Content -LiteralPath $statePath -Encoding UTF8

# 7. Inyectar la instrucción a Claude
$msg = "Cerraste un commit/slice en el branch '$branch' (base '$base'). " +
       "Ejecuta /review-loop AHORA sobre el diff del slice. No preguntes si querés correrlo: corrélo. " +
       "Usá 'git diff $base...HEAD' si el branch tiene base resoluble, o el diff del ultimo commit en repos locales. " +
       "No marques el trabajo como completo hasta que el loop cierre (cero hallazgos de severidad media/alta, o el tope de 5 turnos)."
@{ hookSpecificOutput = @{ hookEventName = "PostToolUse"; additionalContext = $msg } } |
    ConvertTo-Json -Depth 4 -Compress
exit 0
