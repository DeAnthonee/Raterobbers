import Phaser from 'phaser';

/** Idle first scene. Phaser auto-starts the first scene in the config; this one does nothing. */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('boot');
  }
}
