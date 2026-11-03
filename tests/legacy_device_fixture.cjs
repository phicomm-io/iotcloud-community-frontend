// Business-page fixtures model firmware predating token sessions. Keep this
// explicit, and leave all business requests and assertions with the original mock.
module.exports = window => {
 window.TextDecoder=TextDecoder;
 const fetch = window.fetch || (async url => { throw Error(`Unexpected business fetch: ${url}`); });
 window.fetch = async (url, options) => String(url).endsWith('/api/v1/info')
  ? {ok:true,status:200,json:async()=>({code:'ok',data:{api_version:1,device_id:'aabbccddeeff',model:'a1',version:'legacy'}})}
  : String(url).endsWith('/api/v1/auth/login')
  ? {ok: false, status: 404, json: async () => ({code: 'not_found'})}
  : fetch(url, options);
};
