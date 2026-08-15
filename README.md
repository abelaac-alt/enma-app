# Enma

Enma es una aplicación de control menstrual preparada como **PWA web + APK Android desde la misma base de código**.

## Funcionalidades incluidas

- Calendario menstrual mensual.
- Calendario de todo el año con periodos registrados y fechas estimadas.
- Días restantes hasta la próxima regla estimada.
- Registro, edición y eliminación de periodos.
- Duración del periodo ajustable por usuaria.
- Duración inicial del ciclo ajustable.
- Modo de ciclo: automático, regular o irregular.
- Detección de variaciones respecto a los propios registros.
- Cuentas de usuario con email y contraseña.
- Dos perfiles: Mujer y Hombre.
- La mujer dispone de la aplicación completa.
- El hombre accede solo en lectura al ciclo de la mujer vinculada.
- Emparejamiento mediante código temporal de 6 caracteres, válido 24 horas y de un solo uso.
- Desvinculación inmediata desde cualquiera de las dos cuentas.
- Widget nativo Android con días restantes y próxima fecha estimada.
- PWA instalable desde el navegador.
- GitHub Actions para publicar la web y generar el APK automáticamente.
- Seguridad Row Level Security (RLS) en Supabase.

> Enma ofrece estimaciones basadas en los datos introducidos. No es un método anticonceptivo ni una herramienta de diagnóstico médico.

## Arquitectura

- Frontend: JavaScript + Vite 8.
- Android: Capacitor 8.
- Backend: Supabase Auth + PostgreSQL + RLS.
- PWA: manifest + service worker.
- Widget: AppWidgetProvider nativo Android + bridge local de Capacitor.

## 1. Crear el backend en Supabase

1. Crea un proyecto nuevo en Supabase.
2. Abre **SQL Editor**.
3. Copia y ejecuta íntegramente `supabase/schema.sql`.
4. En **Project Settings > API**, copia:
   - Project URL.
   - Publishable/anon key.
5. En **Authentication > URL Configuration**, configura como Site URL la URL final de GitHub Pages cuando la tengas.

Para una prueba privada puedes desactivar temporalmente la confirmación por email. Para producción es preferible mantenerla activa y configurar correctamente las URL de redirección.

## 2. Probar en local

Crea `.env` en la raíz:

```env
VITE_SUPABASE_URL=https://TU-PROYECTO.supabase.co
VITE_SUPABASE_ANON_KEY=TU_CLAVE_ANON_PUBLICA
```

Después:

```bash
npm install
npm test
npm run dev
```

## 3. Subir a GitHub

Crea un repositorio, por ejemplo `enma-app`, y sube **todo el contenido de esta carpeta** a la raíz del repositorio.

En GitHub abre:

**Settings > Secrets and variables > Actions > New repository secret**

Crea estos dos secretos:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

## 4. Publicar la aplicación web

1. En GitHub entra en **Settings > Pages**.
2. En Source selecciona **GitHub Actions**.
3. En **Actions**, ejecuta `Deploy Enma Web` o realiza un push a `main`.
4. GitHub mostrará la URL pública al finalizar.
5. Copia esa URL en Supabase > Authentication > URL Configuration > Site URL.

La web funciona como PWA: en Android/Chrome puede instalarse desde el navegador como aplicación.

## 5. Generar y descargar el APK

El workflow `Build Android APK` crea automáticamente un APK Android instalable.

1. GitHub > **Actions**.
2. Abre `Build Android APK`.
3. Pulsa **Run workflow**.
4. Al terminar, abre la ejecución.
5. En **Artifacts**, descarga `Enma-APK`.
6. Dentro encontrarás `app-debug.apk`.

Ese APK está firmado con la clave de depuración de Android y sirve para instalación directa/pruebas. Para Google Play debe generarse un AAB o APK release firmado con una clave privada de publicación.

## 6. Widget Android

Después de instalar la APK y vincular una pareja:

- En la cuenta Hombre aparece `Añadir widget a inicio`.
- Android solicitará fijar el widget si el launcher lo permite.
- También puede añadirse manteniendo pulsada la pantalla de inicio > Widgets > Enma.
- El widget muestra el nombre de la pareja, días restantes, próxima fecha estimada y estado.
- Se actualiza cuando se abre/sincroniza Enma.

## 7. Lógica del ciclo

En modo automático:

- La app calcula la media de hasta los 6 últimos intervalos entre inicios de periodo.
- Si aún no hay datos suficientes usa la duración inicial configurada (28 días por defecto).
- Las fechas futuras se recalculan al registrar un periodo nuevo.
- La etiqueta Regular/Irregular automática usa la variación de los registros personales como indicador de la app; no constituye una clasificación médica.

## 8. Seguridad

El archivo `supabase/schema.sql` aplica estas reglas principales:

- Una mujer solo puede crear/modificar/eliminar sus propios periodos.
- Un hombre no puede crear, modificar ni borrar periodos.
- Un hombre solo puede leer los datos de la mujer con la que tenga un vínculo activo.
- Un vínculo no puede crearse escribiendo directamente en la tabla: se crea mediante la función segura del código temporal.
- Un código caduca a las 24 horas y queda marcado como utilizado tras el primer uso.
- Un perfil no puede cambiar su tipo Mujer/Hombre después de crearse.
- La desvinculación revoca el acceso inmediatamente.

## 9. Pruebas incluidas

```bash
npm test
```

Comprueban, entre otras cosas:

- cálculo de duración del ciclo;
- predicción de siguiente regla;
- regularidad automática;
- generación de previsiones anuales;
- cálculo de fechas sin errores por cambios de horario de verano.

## Estructura principal

```text
.github/workflows/       GitHub Actions web y APK
native/android/          Widget e icono Android
public/                  PWA, iconos y service worker
scripts/                 Instalación automática del overlay Android
src/                     Aplicación y motor del ciclo
supabase/schema.sql      Base de datos, funciones y RLS
tests/                   Pruebas del motor menstrual
capacitor.config.json    Configuración APK
```

## Privacidad

Los datos menstruales son especialmente sensibles. Si Enma se publica para terceros, prepara una política de privacidad visible, informa de qué datos se guardan, quién es el responsable del tratamiento, cómo solicitar su supresión y revisa las obligaciones aplicables de RGPD antes de poner el servicio en producción.
