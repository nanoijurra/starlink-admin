export async function createSupabaseClient() {
  let config;
  try {
    config = await import('./supabaseClient.js');
  } catch (error) {
    throw new Error('Falta js/supabaseClient.js. Copia supabaseClient.example.js y carga URL + publishable key.');
  }

  if (!window.supabase) {
    throw new Error('No se pudo cargar la libreria de Supabase desde CDN.');
  }

  if (!config.SUPABASE_URL || !config.SUPABASE_ANON_KEY) {
    throw new Error('La configuracion de Supabase esta incompleta.');
  }

  return window.supabase.createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY);
}

export async function signIn(supabase, email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signUp(supabase, email, password) {
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) throw error;
  return data;
}

export async function signOut(supabase) {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function getSession(supabase) {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session;
}

export async function getProfile(supabase, userId) {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle();

  if (error) throw error;
  if (!data) {
    throw new Error('El usuario no tiene profile. Crea el profile o registra la cuenta como USUARIO.');
  }
  if (!data.activo) {
    throw new Error('El profile del usuario no esta activo.');
  }
  return data;
}

export async function ensureUserProfile(supabase, user) {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .maybeSingle();

  if (error) throw error;
  if (data) {
    if (!data.activo) throw new Error('El profile del usuario no esta activo.');
    return data;
  }

  const payload = {
    id: user.id,
    email: user.email,
    rol: 'USUARIO',
    activo: true,
    persona_id: null
  };
  const { data: created, error: insertError } = await supabase
    .from('profiles')
    .insert(payload)
    .select('*')
    .single();

  if (insertError) throw insertError;
  return created;
}
