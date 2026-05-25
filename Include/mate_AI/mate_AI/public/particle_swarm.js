import * as THREE from 'https://esm.sh/three@0.160.0';
import { OrbitControls } from 'https://esm.sh/three@0.160.0/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'https://esm.sh/three@0.160.0/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'https://esm.sh/three@0.160.0/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'https://esm.sh/three@0.160.0/examples/jsm/postprocessing/UnrealBloomPass.js';

export function initParticleSwarm() {
    const container = document.createElement('div');
    container.style.position = 'fixed';
    container.style.top = '0';
    container.style.left = '0';
    container.style.width = '100vw';
    container.style.height = '100vh';
    container.style.zIndex = '-1';
    container.style.background = '#000';
    document.body.appendChild(container);

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog('#000000', 0.01, 1000);

    const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 0, 100);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.autoRotate = true;

    // Post processing
    const renderScene = new RenderPass(scene, camera);
    const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 1.8, 0.4, 0);
    
    const composer = new EffectComposer(renderer);
    composer.addPass(renderScene);
    composer.addPass(bloomPass);

    // Particles
    const count = 20000;
    const geometry = new THREE.TetrahedronGeometry(0.25);
    const material = new THREE.MeshBasicMaterial({ color: 0xffffff });
    
    const instancedMesh = new THREE.InstancedMesh(geometry, material, count);
    
    const dummy = new THREE.Object3D();
    const target = new THREE.Vector3();
    const pColor = new THREE.Color();
    const positions = [];

    for (let i = 0; i < count; i++) {
        positions.push(new THREE.Vector3((Math.random() - 0.5) * 100, (Math.random() - 0.5) * 100, (Math.random() - 0.5) * 100));
        dummy.position.copy(positions[i]);
        dummy.updateMatrix();
        instancedMesh.setMatrixAt(i, dummy.matrix);
        instancedMesh.setColorAt(i, new THREE.Color(0xffffff));
    }
    instancedMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(instancedMesh);

    const clock = new THREE.Clock();
    let speedMult = 1;

    const animate = () => {
        requestAnimationFrame(animate);

        const time = clock.getElapsedTime() * speedMult;

        for (let i = 0; i < count; i++) {
            const R = 25; const r = 8;
            const u = (i / count) * Math.PI * 2 * 40;
            const v = (i / count) * Math.PI * 2;
            
            target.set((R + r * Math.cos(u)) * Math.cos(v), (R + r * Math.cos(u)) * Math.sin(v), r * Math.sin(u));
            pColor.setHex(0xff0055);

            positions[i].lerp(target, 0.1);
            dummy.position.copy(positions[i]);
            dummy.updateMatrix();
            instancedMesh.setMatrixAt(i, dummy.matrix);
            instancedMesh.setColorAt(i, pColor);
        }

        instancedMesh.instanceMatrix.needsUpdate = true;
        if (instancedMesh.instanceColor) instancedMesh.instanceColor.needsUpdate = true;
        
        controls.update();
        composer.render();
    };

    animate();

    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
        composer.setSize(window.innerWidth, window.innerHeight);
    });
}

initParticleSwarm();
