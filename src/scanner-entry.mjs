import { BarcodeFormat,DecodeHintType,RGBLuminanceSource,HybridBinarizer,BinaryBitmap } from '@zxing/library';
import MultiFormatOneDReader from '@zxing/library/esm/core/oned/MultiFormatOneDReader.js';
import { normalizeBarcode } from './domain.mjs';
import { startVideoScan } from './camera-session.mjs';
function reader(){
 const hints=new Map([
  [DecodeHintType.POSSIBLE_FORMATS,[BarcodeFormat.EAN_13,BarcodeFormat.EAN_8,BarcodeFormat.UPC_A,BarcodeFormat.ITF]],
  [DecodeHintType.TRY_HARDER,true]
 ]);
 return {decode(canvas){
  const rgba=canvas.getContext('2d',{willReadFrequently:true}).getImageData(0,0,canvas.width,canvas.height).data;
  const gray=new Uint8ClampedArray(canvas.width*canvas.height);
  for(let pixel=0,offset=0;pixel<gray.length;pixel++,offset+=4)gray[pixel]=(rgba[offset]+rgba[offset+1]*2+rgba[offset+2])/4;
  const bitmap=new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(gray,canvas.width,canvas.height)));
  return new MultiFormatOneDReader(hints).decode(bitmap,hints);
 }};
}
function validCode(value){try{return normalizeBarcode(value);}catch{return null;}}
async function nativeDetector(){
 try{
  if(typeof BarcodeDetector==='undefined')return null;
  const supported=await BarcodeDetector.getSupportedFormats();
  const formats=['ean_13','ean_8','upc_a','itf'].filter(f=>supported.includes(f));
  return formats.length?new BarcodeDetector({formats}):null;
 }catch{return null;}
}
function canvasDecoder(){
 const decoder=reader(),canvas=document.createElement('canvas');
 return source=>{
  const width=source.videoWidth||source.naturalWidth||source.width,height=source.videoHeight||source.naturalHeight||source.height;
  if(!width||!height)return null;
  // Explicit rotation also works around rectangular-frame rotation limitations in ZXing.
  for(const rotated of [false,true]){
   canvas.width=rotated?height:width;canvas.height=rotated?width:height;
   const context=canvas.getContext('2d',{willReadFrequently:true});
   if(!context)throw Error('No se pudo leer la imagen.');
   if(rotated)context.setTransform(0,1,-1,0,height,0);
   context.drawImage(source,0,0,width,height);
   try{const code=validCode(decoder.decode(canvas).getText());if(code)return code;}catch{/* No barcode in this orientation; keep scanning. */}
  }
  return null;
 };
}
async function focusContinuously(track){
 try{
  const modes=track?.getCapabilities?.().focusMode;
  if(Array.isArray(modes)&&modes.includes('continuous'))await track.applyConstraints({advanced:[{focusMode:'continuous'}]});
 }catch{/* Unsupported focus controls must not interrupt camera capture. */}
}
export async function startScanner(video,onCode,isActive=()=>true,onHint=()=>{}){
 let native=await nativeDetector(),misses=0;
 const fallback=canvasDecoder();
 return startVideoScan(video,{
  getStream:()=>navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:'environment'},width:{ideal:1920},height:{ideal:1080}}}),
  configure:focusContinuously,isActive,onCode,onHint,
  decode:async frame=>{
   if(frame.readyState<2)return null;
   if(native){
    try{
     const results=await native.detect(frame);
     for(const result of results){const code=validCode(result.rawValue);if(code)return code;}
     if(++misses%3!==0)return null;
    }catch{native=null;}
   }
   return fallback(frame);
  }
 });
}
export async function decodePhoto(image){
 const native=await nativeDetector();
 if(native){try{for(const result of await native.detect(image)){const code=validCode(result.rawValue);if(code)return code;}}catch{/* Use local fallback. */}}
 const code=canvasDecoder()(image);if(!code)throw Error('No se encontró un código legible.');return code;
}
