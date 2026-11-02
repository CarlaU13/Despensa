import { BrowserMultiFormatReader } from '@zxing/browser';
import { BarcodeFormat,DecodeHintType } from '@zxing/library';
function reader(){
  const hints=new Map([[DecodeHintType.POSSIBLE_FORMATS,[BarcodeFormat.EAN_13,BarcodeFormat.EAN_8,BarcodeFormat.UPC_A,BarcodeFormat.ITF]]]);
  return new BrowserMultiFormatReader(hints,{delayBetweenScanAttempts:180,delayBetweenScanSuccess:800});
}
function value(result){
  return result.getText();
}
export async function startScanner(video,onCode,isActive=()=>true){
  let captured=false;
  const controls=await reader().decodeFromConstraints({audio:false,video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:720}}},video,(result,error,control)=>{
    if(!isActive()){control.stop();return;}
    if(result&&!captured){captured=true;control.stop();onCode(value(result));}
  });
  if(!isActive())controls.stop();
  return controls;
}
export async function decodePhoto(image){return value(await reader().decodeFromImageElement(image));}
