(()=>{
  'use strict';
  const API='https://medication-reminder-push.bmorris0565.workers.dev';
  const SESSION_KEY='medication-reminder-account-session-v1';
  const elements={
    status:document.querySelector('#accountStatus'),
    google:document.querySelector('#googleSignIn'),
    signedIn:document.querySelector('#signedInAccount'),
    identity:document.querySelector('#accountIdentity'),
    plan:document.querySelector('#accountPlan'),
    start:document.querySelector('#usageStartDate'),
    end:document.querySelector('#usageEndDate'),
    save:document.querySelector('#saveUsagePeriod'),
    signOut:document.querySelector('#signOut'),
  };
  let sessionToken='';
  let account=null;
  let clientId='';
  let deviceId='';

  try{
    sessionToken=localStorage.getItem(SESSION_KEY)||'';
    deviceId=localStorage.getItem('medication-reminder-account-device-v1')||crypto.randomUUID();
    localStorage.setItem('medication-reminder-account-device-v1',deviceId);
  }catch(error){console.warn('Account session storage unavailable',error)}

  async function request(path,options={}){
    const response=await fetch(`${API}${path}`,{...options,headers:{'Content-Type':'application/json',...(sessionToken?{Authorization:`Bearer ${sessionToken}`}:{ }),...(options.headers||{})},cache:'no-store'});
    let body={};try{body=await response.json()}catch{}
    if(!response.ok){const error=Error(body.error||`Account request failed (${response.status}).`);error.status=response.status;throw error}
    return body;
  }

  function storeSession(value){
    sessionToken=value||'';
    try{value?localStorage.setItem(SESSION_KEY,value):localStorage.removeItem(SESSION_KEY)}catch(error){console.warn('Account session storage unavailable',error)}
  }

  function render(){
    const signedIn=Boolean(account?.user);
    elements.google.hidden=signedIn;
    elements.signedIn.hidden=!signedIn;
    elements.plan.hidden=!signedIn;
    if(!signedIn){
      elements.status.textContent=clientId?'Sign in to keep cloud features tied to your account. Your schedule remains local unless you pair a device.':'Google Sign-In is temporarily unavailable.';
      return;
    }
    elements.identity.textContent=`${account.user.name} · ${account.user.email}`;
    elements.plan.textContent=account.plan==='advanced'?'Advanced access':'Free access';
    elements.plan.className=`plan-badge ${account.plan==='advanced'?'is-advanced':''}`;
    elements.start.value=account.user.intendedStartDate||'';
    elements.end.value=account.user.intendedEndDate||'';
    elements.status.textContent='Signed in securely. Medication details remain encrypted during paired-device sync.';
    window.dispatchEvent(new CustomEvent('medication-account-changed',{detail:account}));
  }

  function renderGoogleButton(){
    if(!clientId||!window.google?.accounts?.id||account)return;
    elements.google.replaceChildren();
    google.accounts.id.initialize({client_id:clientId,callback:handleGoogleCredential,ux_mode:'popup',auto_select:false,cancel_on_tap_outside:true});
    google.accounts.id.renderButton(elements.google,{type:'standard',theme:'outline',size:'large',text:'signin_with',shape:'pill',logo_alignment:'left'});
  }

  function loadGoogleLibrary(){
    if(window.google?.accounts?.id){renderGoogleButton();return}
    const script=document.createElement('script');
    script.src='https://accounts.google.com/gsi/client';
    script.async=true;
    script.defer=true;
    script.onload=renderGoogleButton;
    script.onerror=()=>{elements.status.textContent='Google Sign-In could not load. Check the connection and try again.'};
    document.head.append(script);
  }

  async function handleGoogleCredential(result){
    if(typeof result?.credential!=='string')return;
    elements.status.textContent='Verifying your Google account…';
    try{
      const installed=matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;
      const deviceType=installed?'pwa':'browser';
      const response=await request('/auth/google',{method:'POST',body:JSON.stringify({credential:result.credential,device:{id:deviceId,type:deviceType,name:installed?'Installed mobile app':'Web browser'}})});
      storeSession(response.sessionToken);
      account=response;
      render();
    }catch(error){
      storeSession('');
      account=null;
      elements.status.textContent=error.message;
      renderGoogleButton();
    }
  }

  async function restoreSession(){
    if(!sessionToken)return;
    elements.status.textContent='Restoring your account…';
    try{account=await request('/auth/me')}catch(error){
      if(error.status===401)storeSession('');
      else elements.status.textContent='Account service is temporarily unavailable. Your local schedule is unaffected.';
      account=null;
    }
  }

  async function initialize(){
    try{
      const config=await request('/auth/config');
      clientId=config.enabled?config.googleClientId:'';
      await restoreSession();
      render();
      if(!account&&clientId)loadGoogleLibrary();
    }catch(error){
      elements.status.textContent='Account service is temporarily unavailable. Your local schedule is unaffected.';
    }
  }

  elements.save.onclick=async()=>{
    elements.save.disabled=true;
    try{
      account=await request('/auth/me',{method:'PATCH',body:JSON.stringify({intendedStartDate:elements.start.value||null,intendedEndDate:elements.end.value||null})});
      render();
      alert('Usage period saved.');
    }catch(error){alert(error.message)}
    finally{elements.save.disabled=false}
  };

  elements.signOut.onclick=async()=>{
    if(!confirm('Sign out on this device? Your local schedules will remain on this device.'))return;
    elements.signOut.disabled=true;
    try{await request('/auth/session',{method:'DELETE'})}catch(error){if(error.status!==401)console.warn('Server sign-out unavailable',error)}
    storeSession('');
    account=null;
    elements.signOut.disabled=false;
    render();
    loadGoogleLibrary();
  };

  window.MedicationAccount={
    get current(){return account},
    get signedIn(){return Boolean(account?.user)},
    get advanced(){return Boolean(account?.features?.advanced)},
    authorizationHeaders(){return sessionToken?{Authorization:`Bearer ${sessionToken}`}:{}} ,
    requireAdvanced(){
      if(!account)throw Error('Sign in with Google before using cloud sync.');
      if(!account.features?.advanced)throw Error('Cloud device sync is an Advanced feature.');
      return true;
    },
  };
  void initialize();
})();
