// The pinned MediaPipe runtime supports Emscripten's instantiateWasm hook.
// Give it a compiled local module so SDK initialization cannot hide a second download.
export function wasmOptions(compiled:WebAssembly.Module){return{
 instantiateWasm(imports:WebAssembly.Imports,ready:(instance:WebAssembly.Instance)=>void){
  const instance=new WebAssembly.Instance(compiled,imports);ready(instance);return instance.exports;
 }
}}
