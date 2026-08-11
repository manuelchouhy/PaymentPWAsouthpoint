# Hook PreToolUse (matcher Edit|Write|MultiEdit). Frena el PRIMER Edit/Write de CODIGO de la sesion
# y le ofrece al usuario alinear (grill) antes de codear. Speed bump: una sola vez por sesion
# (dedup por session_id en .git/alignment-gate-state.json). Los archivos de NO-codigo (docs, *.md,
# .scratch, .agents, .claude, configs, CONTEXT.md, CLAUDE.md, .gitignore) pasan SIEMPRE libres, asi
# alinear/documentar nunca se traba. Cualquier camino que no aplica termina en exit 0 silencioso.
$ErrorActionPreference = "SilentlyContinue"

# 1. Leer el evento del hook por stdin
$raw = [Console]::In.ReadToEnd()
if (-not $raw) { exit 0 }
try { $evt = $raw | ConvertFrom-Json } catch { exit 0 }

# 2. Juntar el/los file_path segun la tool (Edit/Write: tool_input.file_path; MultiEdit: edits[].file_path)
$paths = @()
if ($evt.tool_input.file_path) { $paths += [string]$evt.tool_input.file_path }
foreach ($e in @($evt.tool_input.edits)) { if ($e.file_path) { $paths += [string]$e.file_path } }
if ($paths.Count -eq 0) { exit 0 }

$cwd = if ($evt.cwd) { $evt.cwd } else { (Get-Location).Path }

# 3. Clasificar cada path: no-codigo (allowlist) vs codigo. Solo se frena si hay AL MENOS un path de codigo.
function Is-NonCode($p, $cwd) {
    $rel = ($p -replace '\\', '/')
    if ($cwd) {
        $c = (($cwd -replace '\\', '/').TrimEnd('/'))
        if ($rel.ToLower().StartsWith(($c.ToLower() + '/'))) { $rel = $rel.Substring($c.Length + 1) }
    }
    if ($rel.StartsWith('./')) { $rel = $rel.Substring(2) }
    $leaf = Split-Path $rel -Leaf
    if ($leaf -match '\.(md|json|ya?ml|toml)$') { return $true }
    if (@('CONTEXT.md','CLAUDE.md','.gitignore') -contains $leaf) { return $true }
    foreach ($d in @('docs/', '.scratch/', '.agents/', '.claude/')) {
        if ($rel.ToLower().StartsWith($d)) { return $true }
    }
    return $false
}
$hasCode = $false
foreach ($p in $paths) { if (-not (Is-NonCode $p $cwd)) { $hasCode = $true; break } }
if (-not $hasCode) { exit 0 }   # todo no-codigo: pasa libre, sin marcar la sesion

# 4. Dedup por session_id (una sola vez por sesion). Estado junto a review-loop-state.json.
$sid = if ($evt.session_id) { [string]$evt.session_id } else { "unknown" }
Set-Location -LiteralPath $cwd
$gitDir = (git rev-parse --git-dir 2>$null)
if ($gitDir -and -not [System.IO.Path]::IsPathRooted($gitDir)) { $gitDir = Join-Path $cwd $gitDir }
$stateDir = if ($gitDir) { $gitDir } else { $env:TEMP }
$statePath = Join-Path $stateDir "alignment-gate-state.json"
$state = @{}
if (Test-Path $statePath) {
    try {
        (Get-Content $statePath -Raw | ConvertFrom-Json).PSObject.Properties |
            ForEach-Object { $state[$_.Name] = $_.Value }
    } catch { $state = @{} }
}
if ($state[$sid]) { exit 0 }     # ya avisado en esta sesion
$state[$sid] = $true
([pscustomobject]$state) | ConvertTo-Json | Set-Content -LiteralPath $statePath -Encoding UTF8

# 5. Frenar este Edit y OFRECER alinear (el hook NO ejecuta el grill; lo decide el usuario)
$msg = "Antes de escribir codigo en este trabajo: en esta sesion todavia no se hizo el alignment/grill " +
       "(paso 1 del workflow: Alignment/Grill -> PRD -> task planning; ver CLAUDE.md). No sigas codeando en " +
       "piloto automatico. Ofrecele al usuario: hacemos /grill-me o /grill-with-docs primero, o seguimos " +
       "porque es trivial / ya se alinearon para esto? Espera su decision: NO ejecutes el grill por tu cuenta. " +
       "Si el usuario dice que sigamos, reintenta el Edit y proceds (este aviso no se repite en esta sesion)."
@{ hookSpecificOutput = @{ hookEventName = "PreToolUse"; permissionDecision = "deny"; permissionDecisionReason = $msg } } |
    ConvertTo-Json -Depth 4 -Compress
exit 0
