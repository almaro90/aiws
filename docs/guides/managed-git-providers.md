# GitHub y Azure DevOps gestionados

Cada despliegue registra sus propias aplicaciones externas. La Web guía la interacción humana;
después, repositorios, ramas, importación, Tasks y Runs usan el mismo workflow provider-neutral.

## GitHub App

1. En GitHub, crea una GitHub App privada para la cuenta propietaria.
2. Configura:

   - Homepage URL: `AIWS_PUBLIC_URL`.
   - Setup URL: `${AIWS_PUBLIC_URL}/api/v1/connections/github/callback`.
   - Redirect on update: activado.
   - Webhooks: desactivados; AIWS no los usa.
   - Repository permissions: **Contents — Read and write** y **Pull requests — Read and write**.
     Metadata queda en su acceso read-only implícito. No concedas permisos de organización.

3. Genera una private key, codifica el PEM completo en Base64 sin saltos y anota App ID y slug.
4. Exporta los tres valores antes de `init-secrets.sh`:

   ```bash
   export AIWS_GITHUB_APP_ID=123456
   export AIWS_GITHUB_APP_SLUG=mi-aiws
   export AIWS_GITHUB_PRIVATE_KEY_BASE64='...'
   ```

5. Arranca AIWS. En **Automation**, pulsa **Conectar GitHub**, elige las organizaciones/repositorios
   a los que se instalará la App y vuelve a AIWS.

El CLI `aiws --json connection github-install` devuelve `{ "url": "..." }`; una persona debe
abrirla y completar la instalación. No es un flujo headless.

Referencia: [registro de GitHub Apps](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app)
y [permisos mínimos](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/choosing-permissions-for-a-github-app).

## Microsoft Entra para Azure DevOps Services

1. Registra una aplicación en Microsoft Entra ID.
2. Supported account types: **Accounts in any organizational directory** (multitenant, cuentas
   work/school). No selecciones cuentas Microsoft personales.
3. Añade plataforma **Web** con Redirect URI exacta:

   ```text
   ${AIWS_PUBLIC_URL}/api/v1/connections/azure-devops/callback
   ```

4. En API permissions, añade **Azure DevOps** como recurso y su permiso delegado
   `user_impersonation`. AIWS solicita
   `499b84ac-1321-427f-aa17-267ca6975798/.default offline_access`.
5. Crea un client secret y genera una clave de conexión de 32 bytes en Base64 con
   `aiws-server generate-connection-encryption-key`.
6. Exporta el bloque completo antes de `init-secrets.sh`:

   ```bash
   export AIWS_AZURE_DEVOPS_CLIENT_ID='application-client-id'
   export AIWS_AZURE_DEVOPS_CLIENT_SECRET='client-secret'
   export AIWS_CONNECTION_ENCRYPTION_KEY='base64-32-byte-key'
   ```

7. En **Automation**, pulsa **Conectar Azure DevOps**, completa el consentimiento y selecciona una
   organización del snapshot temporal. También puedes completar esa selección con el CLI.

`aiws --json connection azure-authorize` devuelve una URL que requiere interacción humana. Tras el
callback, copia el `authorizationId` y ejecuta:

```bash
aiws --json connection azure-organizations AUTHORIZATION_ID
aiws --json connection azure-complete AUTHORIZATION_ID \
  --organization-id ORGANIZATION_ID
```

AIWS admite Azure DevOps Services en `dev.azure.com`; no Azure DevOps Server, PAT, MSA, service
principals, Boards ni Pipelines.

Referencia: [Microsoft Entra OAuth para Azure DevOps](https://learn.microsoft.com/en-us/azure/devops/integrate/get-started/authentication/entra-oauth?view=azure-devops)
y [redirect URIs](https://learn.microsoft.com/en-us/entra/identity-platform/reply-url).

## Importar y reautorizar

Después de crear una Connection:

```bash
aiws --json connection list
aiws --json connection repos CONNECTION_ID
aiws --json connection import CONNECTION_ID \
  --repository-id REMOTE_REPOSITORY_ID \
  --account-scope work
aiws --json connection reauthorize CONNECTION_ID
```

`repos` e `import` son provider-neutral. GitHub usa un ID decimal; Azure conserva el UUID remoto.
`reauthorize` vuelve a entregar una URL humana y conserva el ID de Connection.

## Troubleshooting

- `409` al iniciar: el provider no está configurado o la Connection requiere reautorización.
- GitHub `403`: revisa Contents/Pull requests y que la instalación incluya el repositorio.
- Callback rechazado: verifica HTTPS, `AIWS_PUBLIC_URL` y la Setup/Redirect URI exacta.
- Azure `AADSTS50011`: la Redirect URI no coincide carácter por carácter.
- Azure no muestra organizaciones: usa una cuenta work/school con acceso a Azure DevOps y completa
  el consentimiento delegado.
- `reauthorization_required`: el refresh token Azure dejó de ser válido; usa **Reautorizar**.

No pegues private keys, client secrets o tokens en comandos del CLI, Tasks, logs o chats.
