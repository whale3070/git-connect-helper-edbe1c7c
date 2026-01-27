// src/polyfill.ts
if (typeof window !== 'undefined' && !window.crypto.randomUUID) {
  console.log("检测到环境缺失 randomUUID，正在注入物理补丁...");
  // @ts-ignore
  window.crypto.randomUUID = function() {
    return (([1e7] as any) + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, (c: any) =>
      (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16)
    );
  };
}
export {};
