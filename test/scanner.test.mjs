import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {deflateSync} from 'node:zlib';
import {writeFileSync,mkdirSync} from 'node:fs';
const require=createRequire(import.meta.url);
const {MultiFormatReader,BarcodeFormat,DecodeHintType,RGBLuminanceSource,HybridBinarizer,BinaryBitmap}=require('@zxing/library');
export function barcodeImage(code='3017620422003'){
 const L=['0001101','0011001','0010011','0111101','0100011','0110001','0101111','0111011','0110111','0001011'];
 const R=L.map(s=>[...s].map(v=>v==='0'?'1':'0').join('')),G=R.map(s=>[...s].reverse().join(''));
 const parity=['LLLLLL','LLGLGG','LLGGLG','LLGGGL','LGLLGG','LGGLLG','LGGGLL','LGLGLG','LGLGGL','LGGLGL'][Number(code[0])];
 const bits='0'.repeat(12)+'101'+[...code.slice(1,7)].map((d,i)=>(parity[i]==='L'?L:G)[Number(d)]).join('')+'01010'+[...code.slice(7)].map(d=>R[Number(d)]).join('')+'101'+'0'.repeat(12);
 const width=bits.length*4,height=160,pixels=new Uint8ClampedArray(width*height).fill(255);
 for(let y=12;y<height-12;y++)for(let x=0;x<width;x++)if(bits[Math.floor(x/4)]==='1')pixels[y*width+x]=0;
 return {width,height,pixels};
}
export function fixturePng(){
 const {width,height,pixels}=barcodeImage();
 function crc(b){let c=0xffffffff;for(const v of b){c^=v;for(let i=0;i<8;i++)c=c&1?(c>>>1)^0xedb88320:c>>>1;}return(c^0xffffffff)>>>0;}
 function chunk(type,data){const t=Buffer.from(type),n=Buffer.alloc(4),c=Buffer.alloc(4);n.writeUInt32BE(data.length);c.writeUInt32BE(crc(Buffer.concat([t,data])));return Buffer.concat([n,t,data,c]);}
 const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;
 const raw=Buffer.alloc((width+1)*height);for(let y=0;y<height;y++)raw.set(pixels.slice(y*width,(y+1)*width),y*(width+1)+1);
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
}
test('el lector real decodifica un EAN-13 desde píxeles sin servicios externos',()=>{
 const {width,height,pixels}=barcodeImage(),reader=new MultiFormatReader();
 reader.setHints(new Map([[DecodeHintType.POSSIBLE_FORMATS,[BarcodeFormat.EAN_13,BarcodeFormat.UPC_A]]]));
 const result=reader.decodeWithState(new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(pixels,width,height))));
 assert.equal(result.getText(),'3017620422003');
});
if(process.env.DESPENSA_QA_IMAGE){mkdirSync('.local',{recursive:true});writeFileSync('.local/qa-barcode.png',fixturePng());}
