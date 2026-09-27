const platformRoot=location.pathname.startsWith('/admin/')?'/admin':'';
const form=document.querySelector('#onboarding-form'), error=document.querySelector('#error');
const invitation=new URL(location.href).searchParams.get('invitation') || location.hash.slice(1);
// Access preserves the query in its login return URL. Remove it immediately after login; keep it in memory only.
history.replaceState(null,'',platformRoot+'/onboarding');
try {
  const response=await fetch(platformRoot+'/api/platform/onboarding');
  const identity=await response.json();
  if(!response.ok) throw Error(identity.error || 'Log ind for at fortsætte.');
  document.querySelector('#login-email').textContent='Du er logget ind som '+identity.email;
  if(!invitation) throw Error('Åbn linket i invitationsmailen igen.');
} catch(e) {error.textContent=e.message; document.querySelector('#accept').disabled=true;}
form.onsubmit=async event=>{
  event.preventDefault(); const button=document.querySelector('#accept'); button.disabled=true; error.textContent='';
  try {
    const response=await fetch(platformRoot+'/api/platform/onboarding',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...Object.fromEntries(new FormData(form)),token:invitation})});
    const result=await response.json(); if(!response.ok) throw Error(result.error || 'Invitationen kunne ikke accepteres.');
    location.replace(platformRoot+'/');
  }catch(e){error.textContent=e.message;button.disabled=false;}
};
