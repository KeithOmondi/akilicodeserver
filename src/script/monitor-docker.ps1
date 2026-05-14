# scripts/monitor-docker.ps1
Write-Host "Monitoring Docker code execution containers..." -ForegroundColor Green

while ($true) {
    # Get containers with the code-execution label
    $containers = docker ps --filter "label=type=code-execution" --format "{{.ID}} {{.CreatedAt}}" | ForEach-Object {
        $parts = $_ -split ' ', 2
        @{ Id = $parts[0]; CreatedAt = $parts[1] }
    }
    
    foreach ($container in $containers) {
        $createdDate = [DateTime]::Parse($container.CreatedAt)
        $age = (Get-Date) - $createdDate
        
        if ($age.TotalSeconds -gt 60) {
            Write-Host "Killing stale container: $($container.Id) (age: $($age.TotalSeconds)s)" -ForegroundColor Red
            docker kill $container.Id
            docker rm -f $container.Id
        }
    }
    
    Start-Sleep -Seconds 10
}