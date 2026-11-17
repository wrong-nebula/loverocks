import fs from 'node:fs';
import assert from 'node:assert/strict';
import validator from 'gltf-validator';

for(const file of process.argv.slice(2)) {
    const bytes=new Uint8Array(fs.readFileSync(file));
    const result=await validator.validateBytes(bytes,{uri:file,maxIssues:100});
    const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
    const json=JSON.parse(new TextDecoder().decode(bytes.subarray(20,20+view.getUint32(12,true))));
    const primitive=json.meshes[0].primitives[0],material=json.materials[primitive.material];
    assert.equal(result.issues.numErrors,0,JSON.stringify(result.issues,null,2));
    assert.ok(material.pbrMetallicRoughness.baseColorTexture);
    assert.ok(material.pbrMetallicRoughness.metallicRoughnessTexture);
    assert.ok(material.normalTexture&&material.occlusionTexture);
    assert.equal(json.images.length,3,'one albedo, normal and shared ORM image');
    assert.ok(!json.extensionsRequired?.length,'portable core glTF');
    console.log(JSON.stringify({file,bytes:bytes.length,triangles:json.accessors[primitive.indices].count/3,
        vertices:json.accessors[primitive.attributes.POSITION].count,issues:result.issues},null,2));
}
