# Script pour remplacer toutes les instances Prisma par le singleton

$files = @(
    "controllers\adminController.js",
    "controllers\billingController.js",
    "controllers\companyController.js",
    "controllers\importController.js",
    "controllers\suggestionController.js",
    "controllers\assistantController.js",
    "services\messagingService.js",
    "services\assistantService.js",
    "services\adminGuard.js"
)

foreach ($file in $files) {
    $path = Join-Path $PSScriptRoot $file
    if (Test-Path $path) {
        $content = Get-Content $path -Raw
        
        # Remplacer l'import Prisma
        $content = $content -replace 'const \{ PrismaClient \} = require\("\.\.\/generated\/prisma\/client"\);[\r\n]+const prisma = new PrismaClient\(\);', 'const prisma = require("../services/prisma");'
        $content = $content -replace 'const \{ PrismaClient \} = require\(''\.\.\/generated\/prisma\/client''\);[\r\n]+const prisma = new PrismaClient\(\);', 'const prisma = require(''../services/prisma'');'
        
        # Pour les services
        $content = $content -replace 'const \{ PrismaClient \} = require\(''\.\.\/\.\.\/generated\/prisma\/client''\);[\r\n]+const prisma = new PrismaClient\(\);', 'const prisma = require(''./prisma'');'
        
        Set-Content $path -Value $content -NoNewline
        Write-Host "Updated: $file"
    }
}

Write-Host "Prisma singleton replacement complete!"
