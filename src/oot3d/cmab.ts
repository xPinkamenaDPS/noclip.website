
import AnimationController from "../AnimationController";
import ArrayBufferSlice from "../ArrayBufferSlice";
import { readString, assert } from "../util";
import { mat4, vec4 } from "gl-matrix";
import { Color, colorFromRGBA } from "../Color";

// CMAB (CTR Material Animation Binary)
// Seems to be inspired by the .cmata file format. Perhaps an earlier version of NW4C used it?

const enum AnimationTrackType {
    LINEAR = 0x01,
    HERMITE = 0x02,
};

interface AnimationKeyframeLinear {
    time: number;
    value: number;
}

interface AnimationKeyframeHermite {
    time: number;
    value: number;
    tangentIn: number;
    tangentOut: number;
}

interface AnimationTrackLinear {
    type: AnimationTrackType.LINEAR;
    frames: AnimationKeyframeLinear[];
}

interface AnimationTrackHermite {
    type: AnimationTrackType.HERMITE;
    frames: AnimationKeyframeHermite[];
}

type AnimationTrack = AnimationTrackLinear | AnimationTrackHermite;

export interface AnimationEntry {
    animationType: number;
    materialIndex: number;
    channelIndex: number;
    tracks: AnimationTrack[];
};

interface AnimationBase {
    duration: number;
    loopMode: LoopMode;
}

export interface CMAB extends AnimationBase {
    animEntries: AnimationEntry[];
};

export const enum AnimationType {
    TRANSLATION = 0x01,
    UNK_04 = 0x04,
    ROTATION = 0x05,
}

const enum LoopMode {
    ONCE, REPEAT,
}

export const enum Version {
    Ocarina, Majora
}

function parseTrack(version: Version, buffer: ArrayBufferSlice): AnimationTrack {
    const view = buffer.createDataView();

    let type: AnimationTrackType;
    let numKeyframes: number;
    let timeEnd: number;
    let unk1: number, unk2: number;

    if (version === Version.Ocarina) {
        type = view.getUint32(0x00, true);
        numKeyframes = view.getUint32(0x04, true);
        timeEnd = view.getUint32(0x08, true);
        unk1 = 1.0;
        unk2 = view.getUint32(0x0C, true);
    } else if (version === Version.Majora) {
        type = view.getUint16(0x00, true);
        numKeyframes = view.getUint16(0x02, true);
        timeEnd = view.getUint32(0x04, true);
        unk1 = view.getFloat32(0x08, true);
        unk2 = view.getUint32(0x0C, true);
    }

    let keyframeTableIdx: number = 0x10;

    // WTF does this mean?
    if (numKeyframes === 0)
        return undefined;

    if (type === AnimationTrackType.LINEAR) {
        const frames: AnimationKeyframeLinear[] = [];
        for (let i = 0; i < numKeyframes; i++) {
            const time = view.getUint32(keyframeTableIdx + 0x00, true);
            const value = view.getFloat32(keyframeTableIdx + 0x04, true);
            keyframeTableIdx += 0x08;
            frames.push({ time, value });
        }
        return { type, frames };
    } else if (type === AnimationTrackType.HERMITE) {
        const frames: AnimationKeyframeHermite[] = [];
        for (let i = 0; i < numKeyframes; i++) {
            const time = view.getUint32(keyframeTableIdx + 0x00, true);
            const value = view.getFloat32(keyframeTableIdx + 0x04, true);
            const tangentIn = view.getUint32(keyframeTableIdx + 0x08, true);
            const tangentOut = view.getUint32(keyframeTableIdx + 0x0C, true);
            keyframeTableIdx += 0x10;
            frames.push({ time, value, tangentIn, tangentOut });
        }
        return { type, frames };
    } else {
        throw "whoops";
    }
}

function parseMmad(version: Version, buffer: ArrayBufferSlice): AnimationEntry {
    const view = buffer.createDataView();

    assert(readString(buffer, 0x00, 0x04, false) === 'mmad');

    const animationType: AnimationType = view.getUint32(0x04, true);
    const materialIndex = view.getUint32(0x08, true);
    const channelIndex = view.getUint32(0x0C, true);

    let trackOffsTableIdx = 0x10;
    const tracks: AnimationTrack[] = [];

    if (animationType === AnimationType.TRANSLATION) {
        for (let i = 0; i < 2; i++) {
            const trackOffs = view.getUint16(trackOffsTableIdx, true);
            trackOffsTableIdx += 0x02;

            if (trackOffs === 0x00)
                continue;

            tracks[i] = parseTrack(version, buffer.slice(trackOffs));
        }
    } else if (animationType === AnimationType.UNK_04) {
        for (let i = 0; i < 4; i++) {
            const trackOffs = view.getUint16(trackOffsTableIdx, true);
            trackOffsTableIdx += 0x02;

            if (trackOffs === 0x00)
                continue;

            tracks[i] = parseTrack(version, buffer.slice(trackOffs));
        }
    } else if (animationType === AnimationType.ROTATION) {
        for (let i = 0; i < 1; i++) {
            const trackOffs = view.getUint16(trackOffsTableIdx, true);
            trackOffsTableIdx += 0x02;

            if (trackOffs === 0x00)
                continue;

            tracks[i] = parseTrack(version, buffer.slice(trackOffs));
        }
    }

    return { animationType, materialIndex, channelIndex, tracks };
}

export function parse(version: Version, buffer: ArrayBufferSlice): CMAB {
    const view = buffer.createDataView();

    assert(readString(buffer, 0x00, 0x04, false) === 'cmab');
    // smh Nintendo doesn't change the version field
    const subversion = view.getUint32(0x04, true);
    assert(subversion === 0x01);

    const size = view.getUint32(0x08, true);
    assert(view.getUint32(0x0C, true) === 0x00);

    assert(view.getUint32(0x10, true) === 0x01); // num chunks?
    assert(view.getUint32(0x14, true) === 0x20); // chunk location?

    // String table, unused.
    const strTableChunkOffs = view.getUint32(0x18, true);
    assert(readString(buffer, strTableChunkOffs, 0x04, false) === 'strt');

    assert(view.getUint32(0x20, true) === 0xFFFFFFFF); // chunk type?
    const duration = view.getUint32(0x24, true);
    // TODO(jstpierre): This breaks in shrine. Loop mode, maybe?
    // assert(view.getUint32(0x28, true) === 0x01); // num chunks?
    assert(view.getUint32(0x2C, true) === 0x14); // chunk location?

    const loopMode = LoopMode.REPEAT;

    const madsChunkOffs = 0x34;
    assert(readString(buffer, madsChunkOffs + 0x00, 0x04, false) === 'mads');
    const numAnimations = view.getUint32(madsChunkOffs + 0x04, true);

    const animEntries: AnimationEntry[] = [];    
    let mmadAnimationTableIdx = madsChunkOffs + 0x08;
    for (let i = 0; i < numAnimations; i++) {
        const mmadAnimChunkOffs = madsChunkOffs + view.getUint32(mmadAnimationTableIdx + 0x00, true);
        animEntries.push(parseMmad(version, buffer.slice(mmadAnimChunkOffs)));
        mmadAnimationTableIdx += 0x04;
    }

    return { duration, loopMode, animEntries };
}

function lerp(k0: AnimationKeyframeLinear, k1: AnimationKeyframeLinear, t: number) {
    return k0.value + (k1.value - k0.value) * t;
}

function sampleAnimationTrackLinear(track: AnimationTrackLinear, frame: number): number {
    const frames = track.frames;

    if (frames.length === 1)
        return frames[0].value;

    // Find the first frame.
    const idx1 = frames.findIndex((key) => (frame < key.time));
    if (idx1 < 0)
        return frames[frames.length - 1].value;
    const idx0 = idx1 - 1;

    const k0 = frames[idx0];
    const k1 = frames[idx1];

    const t = (frame - k0.time) / (k1.time - k0.time);
    return lerp(k0, k1, t);
}

function cubicEval(cf0: number, cf1: number, cf2: number, cf3: number, t: number): number {
    return (((cf0 * t + cf1) * t + cf2) * t + cf3);
}

function hermiteInterpolate(k0: AnimationKeyframeHermite, k1: AnimationKeyframeHermite, t: number): number {
    const length = k1.time - k0.time;
    const p0 = k0.value;
    const p1 = k1.value;
    const s0 = k0.tangentOut * length;
    const s1 = k1.tangentIn * length;
    const cf0 = (p0 *  2) + (p1 * -2) + (s0 *  1) +  (s1 *  1);
    const cf1 = (p0 * -3) + (p1 *  3) + (s0 * -2) +  (s1 * -1);
    const cf2 = (p0 *  0) + (p1 *  0) + (s0 *  1) +  (s1 *  0);
    const cf3 = (p0 *  1) + (p1 *  0) + (s0 *  0) +  (s1 *  0);
    return cubicEval(cf0, cf1, cf2, cf3, t);
}

function sampleAnimationTrackHermite(track: AnimationTrackHermite, frame: number) {
    const frames = track.frames;

    if (frames.length === 1)
        return frames[0].value;

    // Find the first frame.
    const idx1 = frames.findIndex((key) => (frame < key.time));
    if (idx1 < 0)
        return frames[frames.length - 1].value;
    const idx0 = idx1 - 1;

    const k0 = frames[idx0];
    const k1 = frames[idx1];

    // HACK(jstpierre): Nintendo sometimes uses weird "reset" tangents
    // which aren't supposed to be visible. They are visible for us because
    // "frame" can have a non-zero fractional component. In this case, pick
    // a value completely.
    if ((k1.time - k0.time) === 1)
        return k0.value;

    const t = (frame - k0.time) / (k1.time - k0.time);
    return hermiteInterpolate(k0, k1, t);
}

function sampleAnimationTrack(track: AnimationTrack, frame: number): number {
    if (track.type === AnimationTrackType.LINEAR)
        return sampleAnimationTrackLinear(track, frame);
    else if (track.type === AnimationTrackType.HERMITE)
        return sampleAnimationTrackHermite(track, frame);
    else
        throw "whoops";
}

function getAnimFrame(anim: AnimationBase, frame: number): number {
    // Be careful of floating point precision.
    const lastFrame = anim.duration;
    if (anim.loopMode === LoopMode.ONCE) {
        if (frame > lastFrame)
            frame = lastFrame;
        return frame;
    } else if (anim.loopMode === LoopMode.REPEAT) {
        while (frame > lastFrame)
            frame -= lastFrame;
        return frame;
    } else {
        throw "whoops";
    }
}

export class TextureAnimator {
    constructor(public animationController: AnimationController, public cmab: CMAB, public animEntry: AnimationEntry) {
        assert(animEntry.animationType === AnimationType.TRANSLATION || animEntry.animationType === AnimationType.ROTATION);
    }

    public calcTexMtx(dst: mat4): void {
        const animFrame = getAnimFrame(this.cmab, this.animationController.getTimeInFrames());
        mat4.identity(dst);

        if (this.animEntry.animationType === AnimationType.TRANSLATION) {
            const tx = this.animEntry.tracks[0] !== undefined ? sampleAnimationTrack(this.animEntry.tracks[0], animFrame) : 0;
            const ty = this.animEntry.tracks[1] !== undefined ? sampleAnimationTrack(this.animEntry.tracks[1], animFrame) : 0;
            dst[12] = -tx;
            dst[13] = -ty;
        } else if (this.animEntry.animationType === AnimationType.ROTATION) {
            const r = this.animEntry.tracks[0] !== undefined ? sampleAnimationTrack(this.animEntry.tracks[0], animFrame) : 0;
            mat4.rotateZ(dst, dst, r);
        } else {
            throw "whoops";
        }
    }
}

export class ColorAnimator {
    constructor(public animationController: AnimationController, public cmab: CMAB, public animEntry: AnimationEntry) {
        assert(animEntry.animationType === AnimationType.UNK_04);
    }

    public calcMaterialColor(dst: Color): void {
        const animFrame = getAnimFrame(this.cmab, this.animationController.getTimeInFrames());
        const r = this.animEntry.tracks[0] !== undefined ? sampleAnimationTrack(this.animEntry.tracks[0], animFrame) : 1;
        const g = this.animEntry.tracks[1] !== undefined ? sampleAnimationTrack(this.animEntry.tracks[1], animFrame) : 1;
        const b = this.animEntry.tracks[2] !== undefined ? sampleAnimationTrack(this.animEntry.tracks[2], animFrame) : 1;
        const a = this.animEntry.tracks[3] !== undefined ? sampleAnimationTrack(this.animEntry.tracks[3], animFrame) : 1;
        colorFromRGBA(dst, r, g, b, a);
    }
}