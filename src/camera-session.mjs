// Camera lifecycle is independent from barcode recognition and never uploads frames.
export async function startVideoScan(video,{
 getStream,decode,configure=async()=>{},isActive=()=>true,onCode,onHint=()=>{},
 schedule=setTimeout,cancel=clearTimeout,now=Date.now
}){
 let stream=null,timer=null,stopped=false,hinted=false;
 const started=now();
 function stop(){
  if(stopped)return;stopped=true;
  if(timer!==null)cancel(timer);
  if(stream){for(const track of stream.getTracks())track.stop();if(video.srcObject===stream)video.srcObject=null;stream=null;}
 }
 const controls={stop};
 try{
  if(!isActive()){stop();return controls;}
  stream=await getStream();
  if(!isActive()){stop();return controls;}
  video.srcObject=stream;video.muted=true;video.playsInline=true;
  await configure(stream.getVideoTracks()[0]);
  if(!isActive()){stop();return controls;}
  await video.play();
  if(!isActive()){stop();return controls;}
  async function tick(){
   if(stopped)return;
   if(!isActive()){stop();return;}
   let code;
   try{code=await decode(video);}catch{stop();onHint('La lectura de la cámara se interrumpió. Volvé a abrirla o usá una foto o el código escrito.');return;}
   if(stopped)return;
   if(!isActive()){stop();return;}
   if(code){stop();onCode(code);return;}
   if(!hinted&&now()-started>=8000){hinted=true;onHint('Todavía no se reconoce el código. Mantenelo completo, horizontal y con margen blanco. Alejá un poco el envase y evitá reflejos. La búsqueda sigue activa.');}
   timer=schedule(tick,180);
  }
  void tick();
  return controls;
 }catch(error){stop();throw error;}
}
