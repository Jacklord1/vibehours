# Prints one line for each connection Windows logged against electron.exe
# since the given time, as "direction address:port", leaving out the PC's
# own loopback. Used by scripts/quiet.sh, which turns the audit on first.
# Events 5156 (allowed) and 5157 (blocked) in the Security log.
param([Parameter(Mandatory = $true)][string]$Since)
$from = [datetime]::Parse($Since, $null, [System.Globalization.DateTimeStyles]::RoundtripKind)
$events = Get-WinEvent -FilterHashtable @{ LogName = "Security"; Id = 5156, 5157; StartTime = $from } -ErrorAction SilentlyContinue
foreach ($e in $events) {
  $d = @{}
  foreach ($x in ([xml]$e.ToXml()).Event.EventData.Data) { $d[$x.Name] = $x."#text" }
  if ($d["Application"] -notmatch "\\electron\.exe$") { continue }
  $to = $d["DestAddress"]
  if ($to -match "^127\." -or $to -eq "::1" -or $to -eq "0.0.0.0" -or $to -eq "::") { continue }
  $way = if ($d["Direction"] -eq "%%14593") { "out" } else { "in" }
  "$way $($to):$($d["DestPort"])"
}
