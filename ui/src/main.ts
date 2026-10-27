import { createApp } from 'vue';
import App from './App.vue';
import { initSkin } from './skin';
import './styles/main.css';
import './styles/skins/cosmic-glass.css';

initSkin();
createApp(App).mount('#app');
