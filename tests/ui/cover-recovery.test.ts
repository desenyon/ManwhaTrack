// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
vi.mock("../../src/storage/repositories/covers",()=>({getCover:async(id:string)=>({id,blob:new Blob([id])})}));
import { Cover } from "../../src/ui/Cover";
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
Object.assign(URL,{createObjectURL:(blob:Blob)=>`blob:cover-${blob.size}-${crypto.randomUUID()}`});
it("shows a replacement cover after a prior image failed to decode",async()=>{
 const host=document.createElement("div");document.body.append(host);const root=createRoot(host);
 try{
  await act(async()=>root.render(createElement(Cover,{coverId:"bad",title:"Local title"})));
  await act(async()=>host.querySelector("img")!.dispatchEvent(new Event("error")));
  expect(host.querySelector("img")).toBeNull();expect(host.textContent).toBe("L");
  await act(async()=>root.render(createElement(Cover,{coverId:"replacement",title:"Local title"})));
  expect(host.querySelector("img")?.getAttribute("alt")).toBe("Cover of Local title");
 }finally{await act(async()=>root.unmount());host.remove()}
});
