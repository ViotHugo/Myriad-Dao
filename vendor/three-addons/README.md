# three-addons

Verbatim copies of `three@0.170.0/examples/jsm`, matching the core in
`vendor/three.module.min.js`. MIT, same licence as the core — see
`../THREE-LICENSE.txt`.

    postprocessing/EffectComposer.js
    postprocessing/RenderPass.js
    postprocessing/ShaderPass.js
    postprocessing/UnrealBloomPass.js
    postprocessing/MaskPass.js        (EffectComposer imports it)
    postprocessing/Pass.js            (base class + FullScreenQuad)
    shaders/CopyShader.js             (EffectComposer's internal copy pass)
    shaders/LuminosityHighPassShader.js  (UnrealBloomPass's threshold)

Nothing here is edited. The game's own post pass — paper, vignette, ACES, the
ink dissolve — lives in `js/view3d/shaders.js` and is handed to `ShaderPass` as
a ready-made material; see `js/view3d/post.js`.

To re-vendor after a core bump:

    npm pack three@<version>
    tar xzf three-<version>.tgz
    cp package/examples/jsm/postprocessing/{EffectComposer,RenderPass,ShaderPass,MaskPass,Pass,UnrealBloomPass}.js vendor/three-addons/postprocessing/
    cp package/examples/jsm/shaders/{CopyShader,LuminosityHighPassShader}.js vendor/three-addons/shaders/
