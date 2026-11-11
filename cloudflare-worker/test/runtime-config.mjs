import {readFileSync} from 'node:fs';
export function productionCompatibility(env=process.env) {
  const config=JSON.parse(readFileSync(new URL('../wrangler.jsonc',import.meta.url),'utf8'));
  if(env.HATCHAI_RUNTIME_COMPAT_DATE && env.HATCHAI_RUNTIME_COMPAT_DATE!==config.compatibility_date)
    throw new Error('Runtime date override differs from production configuration; verification refused.');
  const flags=config.compatibility_flags||[];
  if(!/^\d{4}-\d{2}-\d{2}$/.test(config.compatibility_date)||!Array.isArray(flags)||!flags.every(x=>typeof x==='string'))throw new Error('Invalid runtime configuration');
  return {compatibilityDate:config.compatibility_date,compatibilityFlags:[...flags]};
}

export async function productionBundle(){const {build}=await import('esbuild');const {fileURLToPath}=await import('node:url');const result=await build({entryPoints:[fileURLToPath(new URL('../src/index.js',import.meta.url))],bundle:true,write:false,format:'esm',platform:'browser',target:'es2022'});return {modules:true,script:result.outputFiles[0].text};}
