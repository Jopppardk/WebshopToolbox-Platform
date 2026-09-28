const form=document.querySelector('#signup-form'),message=document.querySelector('#message'),error=document.querySelector('#error');
form.addEventListener('submit',async event=>{
 event.preventDefault();const button=form.querySelector('button');button.disabled=true;error.textContent='';
 try{const values=Object.fromEntries(new FormData(form));values.accept=form.elements.accept.checked;
 const response=await fetch('/auth/signup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(values)});const body=await response.json();
 if(!response.ok)throw new Error(body.error||'Tilmeldingen kunne ikke gennemføres.');
 message.textContent=body.message||'Tilmeldingen er registreret.';form.hidden=true;
 if(body.previewLink){const a=document.createElement('a');a.href=body.previewLink;a.textContent='Åbn lokal testinvitation';message.append(document.createElement('br'),a);}
 }catch(e){error.textContent=e.message||'Forbindelsen blev afbrudt. Kontrollér din mail, før du prøver igen.';}finally{button.disabled=false;}
});
