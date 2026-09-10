import {database} from './database';
import {loadCredentials} from './credentials';
import {readDineroAccounts} from './dinero-accounts';
import {validateSettings} from '@/lib/admin-settings';
import {TransferError} from '@/lib/dinero-sale';
export async function flatpayProduction(activate=false){
 const db=database(),c=await loadCredentials('flatpay',true),dinero=await loadCredentials('dinero',true);
 const row=await db.prepare("SELECT setting_value FROM app_settings WHERE tenant='sablen.dk' AND setting_key='flatpay_production'").first<{setting_value:string}>();
 const config=row?JSON.parse(row.setting_value):null;
 const scoped=!!c&&!!dinero&&config?.merchantID===c.merchantID&&config.agreementId===c.agreementId&&config.organizationId===dinero.organizationId;
 if(!activate)return {active:scoped&&config.enabled===true};
 if(!c||!dinero?.organizationId)throw new TransferError('Forbind Flatpay og Dinero først.');
 const setting=await db.prepare("SELECT setting_value FROM app_settings WHERE tenant='sablen.dk' AND setting_key='admin_settings'").first<{setting_value:string}>();
 if(!setting)throw new TransferError('Gem kontoplanen først.');
 const settings=validateSettings(JSON.parse(setting.setting_value));
 const numbers=['bank','fees','clearing','flatpayClearing'].map(k=>Number(settings.accounts[k as keyof typeof settings.accounts]?.match(/^\d+/)?.[0]));
 const chart=await readDineroAccounts(dinero);
 if(new Set(numbers).size!==4||numbers.some(n=>!Number.isSafeInteger(n)||!chart.some(a=>Number(a.number)===n&&!a.hidden&&!a.vatCode)))throw new TransferError('Vælg fire forskellige aktive konti uden moms til bank, gebyr, fordeling og Flatpay.');
 if(!settings.automation.payouts)throw new TransferError('Aktivér Udbetalinger under Indstillinger først.');
 const next={enabled:true,merchantID:c.merchantID,agreementId:c.agreementId,organizationId:dinero.organizationId,holdIds:scoped&&Array.isArray(config.holdIds)?config.holdIds:[],activatedAt:new Date().toISOString()};
 await db.prepare("INSERT INTO app_settings(tenant,setting_key,setting_value) VALUES('sablen.dk','flatpay_production',?) ON CONFLICT(tenant,setting_key) DO UPDATE SET setting_value=excluded.setting_value,updated_at=CURRENT_TIMESTAMP").bind(JSON.stringify(next)).run();
 return {active:true};
}
