#!/usr/bin/env python3
import argparse
import json
import math
import subprocess
import sys
import tempfile
from pathlib import Path

import bpy
from mathutils import Vector


SHAPES = {"cube", "cylinder", "sphere", "human", "weapon", "effect"}
WEAPON_TYPES = {"sword", "dao", "spear", "staff", "shield"}
EFFECT_TYPES = {"orb", "beam", "ring", "burst"}
PREVIZ_REQUIRED_HARD_GATES = {"剧情因果", "人数与身份", "轴线与屏幕方向", "物理接触", "关键物可见"}
RIGS = {}
SCENE_OBJECTS = {}
OBJECT_MARKERS = {}
RIG_BASE_ROTATIONS = {}
FINGER_BASE_ROTATIONS = {}
DEFAULT_MANNEQUIN_MODEL = Path(__file__).resolve().parents[1] / "public" / "models" / "ue-mannequin-retopology.glb"
UE_BONES = {
    "pelvis": "Bip001 Pelvis_03",
    "spine": "Bip001 Spine_04",
    "chest": "Bip001 Spine1_05",
    "left_clavicle": "Bip001 L Clavicle_07",
    "right_clavicle": "Bip001 R Clavicle_031",
    "head": "Bip001 Head_055",
    "left_arm": "Bip001 L UpperArm_08",
    "right_arm": "Bip001 R UpperArm_032",
    "left_forearm": "Bip001 L Forearm_09",
    "right_forearm": "Bip001 R Forearm_033",
    "left_hand": "Bip001 L Hand_010",
    "right_hand": "Bip001 R Hand_034",
    "left_leg": "Bip001 L Thigh_057",
    "right_leg": "Bip001 R Thigh_061",
    "left_calf": "Bip001 L Calf_058",
    "right_calf": "Bip001 R Calf_062",
    "left_foot": "Bip001 L Foot_059",
    "right_foot": "Bip001 R Foot_063",
}
FINGER_BONES = {
    "left": ["Bip001 L Finger0_011", "Bones L Finger01_012", "Bones L Finger02_013", "Bones L Finger1_015", "Bones L Finger11_016", "Bones L Finger12_017", "Bones L Finger2_019", "Bones L Finger21_020", "Bones L Finger22_021", "Bones L Finger3_023", "Bones L Finger31_024", "Bones L Finger32_025", "Bones L Finger4_027", "Bones L Finger41_028", "Bones L Finger42_029"],
    "right": ["Bip001 R Finger0_035", "Bones R Finger01_036", "Bones R Finger02_037", "Bones R Finger1_039", "Bones R Finger11_040", "Bones R Finger12_041", "Bones R Finger2_043", "Bones R Finger21_044", "Bones R Finger22_045", "Bones R Finger3_047", "Bones R Finger31_048", "Bones R Finger32_049", "Bones R Finger4_051", "Bones R Finger41_052", "Bones R Finger42_053"],
}


def arguments():
    values = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
    parser = argparse.ArgumentParser(description="根据 JSON 场景合同生成 Blender 灰模预演")
    parser.add_argument("--spec", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--blend-output", type=Path)
    parser.add_argument("--mannequin-model", type=Path, default=DEFAULT_MANNEQUIN_MODEL)
    parser.add_argument("--expected-duration", type=float)
    parser.add_argument("--demo", action="store_true")
    parser.add_argument("--self-check", action="store_true")
    return parser.parse_args(values)


def demo_spec():
    return {
        "fps": 12,
        "duration_seconds": 3,
        "resolution": [640, 360],
        "camera": {
            "location": [8, -11, 6],
            "target": [0, 0, 1.3],
            "lens": 48,
            "keyframes": [
                {"frame": 1, "location": [8, -11, 6]},
                {"frame": 36, "location": [6.5, -9, 5]},
            ],
        },
        "objects": [
            {"name": "人物A", "shape": "human", "location": [-3, 0, 0], "scale": [1, 1, 1], "walk": {"start_frame": 1, "end_frame": 30, "step_frames": 6, "swing_degrees": 20}, "keyframes": [{"frame": 1, "location": [-3, 0, 0]}, {"frame": 30, "location": [-0.8, 0, 0]}]},
            {"name": "人物B", "shape": "human", "location": [1.2, 0.4, 0], "scale": [1, 1, 1]},
            {"name": "桌子", "shape": "cube", "location": [0, 2.2, 0.55], "scale": [2.2, 0.8, 0.55]},
            {"name": "门框左", "shape": "cube", "location": [-4.3, 3.5, 1.5], "scale": [0.2, 0.3, 1.5]},
            {"name": "门框右", "shape": "cube", "location": [-2.3, 3.5, 1.5], "scale": [0.2, 0.3, 1.5]},
            {"name": "门框顶", "shape": "cube", "location": [-3.3, 3.5, 3], "scale": [1.2, 0.3, 0.2]},
        ],
    }


def validate(spec):
    if not isinstance(spec, dict) or not isinstance(spec.get("objects"), list):
        raise ValueError("spec.objects 必须是数组")
    if "schema_version" in spec or "source" in spec or "direction" in spec:
        if spec.get("schema_version") != 1:
            raise ValueError("白模导演合同 schema_version 必须为 1")
        source = spec.get("source")
        if not isinstance(source, dict) or not isinstance(source.get("episode_key"), str) or not source["episode_key"].startswith("ep-") or not isinstance(source.get("storyboard_version"), str) or not isinstance(source.get("production_plan_version"), str) or not isinstance(source.get("shot_number"), int) or source["shot_number"] < 1 or source.get("storyboard_medium") != "blender" or source.get("board_asset") is not None:
            raise ValueError("白模导演合同 source 无效")
        direction = spec.get("direction")
        if not isinstance(direction, dict) or any(not isinstance(direction.get(field), str) or not direction[field].strip() for field in ("dramatic_intent", "primary_read")):
            raise ValueError("白模导演合同缺少剧情意图或首要信息")
        axis = direction.get("axis")
        if not isinstance(axis, dict) or any(not isinstance(axis.get(field), str) or not axis[field].strip() for field in ("line", "camera_side", "screen_direction")):
            raise ValueError("白模导演合同轴线定义不完整")
        camera_direction = direction.get("camera")
        if not isinstance(camera_direction, dict) or any(not isinstance(camera_direction.get(field), str) or not camera_direction[field].strip() for field in ("shot_size", "principal_move", "motivation")):
            raise ValueError("白模导演合同相机动机不完整")
        continuity = direction.get("continuity")
        if not isinstance(continuity, dict) or any(not isinstance(continuity.get(field), str) or not continuity[field].strip() for field in ("entry_exit", "eyelines", "end_state")):
            raise ValueError("白模导演合同连续性定义不完整")
    fps = spec.get("fps", 12)
    duration = spec.get("duration_seconds", 3)
    resolution = spec.get("resolution", [640, 360])
    if not isinstance(fps, int) or not 6 <= fps <= 30:
        raise ValueError("fps 必须是 6–30 的整数")
    if not isinstance(duration, (int, float)) or not 0 < duration <= 30:
        raise ValueError("duration_seconds 必须在 0–30 秒内")
    if not isinstance(resolution, list) or len(resolution) != 2 or any(not isinstance(value, int) or value < 64 or value > 4096 for value in resolution):
        raise ValueError("resolution 必须是 64–4096 范围内的 [宽, 高]")
    if "direction" in spec:
        beats = spec["direction"].get("beats")
        last_frame = round(fps * duration)
        if not isinstance(beats, list) or not beats:
            raise ValueError("白模导演合同 beats[] 不得为空")
        covered_until = 0
        previous_end = 0
        for index, beat in enumerate(beats):
            if not isinstance(beat, dict) or any(not isinstance(beat.get(field), str) or not beat[field].strip() for field in ("name", "actor", "action", "result")) or not isinstance(beat.get("start_frame"), int) or not isinstance(beat.get("end_frame"), int) or not 1 <= beat["start_frame"] <= beat["end_frame"] <= last_frame:
                raise ValueError(f"白模导演合同 beats[{index}] 无效")
            if beat["start_frame"] > covered_until + 1:
                raise ValueError(f"白模导演合同节拍在第 {covered_until + 1} 帧出现空档")
            if index > 0 and beat["start_frame"] < previous_end:
                raise ValueError(f"白模导演合同 beats[{index}] 与前一节拍倒序或过度重叠")
            covered_until = max(covered_until, beat["end_frame"])
            previous_end = beat["end_frame"]
        if beats[0]["start_frame"] != 1 or covered_until != last_frame:
            raise ValueError("白模导演合同节拍必须覆盖首帧到镜尾")
        review = spec.get("review_contract")
        if not isinstance(review, dict) or review.get("score_target") != 85 or not isinstance(review.get("hard_gates"), list) or not PREVIZ_REQUIRED_HARD_GATES.issubset(review["hard_gates"]) or any(not isinstance(item, str) or not item.strip() for item in review["hard_gates"]):
            raise ValueError("白模导演合同 review_contract 无效")
    camera_specs = spec.get("cameras")
    if camera_specs is None:
        camera_specs = [spec.get("camera", {})]
    if not isinstance(camera_specs, list) or not camera_specs:
        raise ValueError("cameras 必须是非空数组")
    camera_names = set()
    for camera_index, camera in enumerate(camera_specs):
        label = f"cameras[{camera_index}]" if "cameras" in spec else "camera"
        if not isinstance(camera, dict) or not isinstance(camera.get("keyframes", []), list):
            raise ValueError(f"{label} 必须是对象且 keyframes 必须是数组")
        name = camera.get("name", "主相机" if len(camera_specs) == 1 else None)
        if not isinstance(name, str) or not name or name in camera_names:
            raise ValueError("多机位 cameras[].name 必须是非空且唯一的字符串")
        camera_names.add(name)
        for field in ("location", "target"):
            value = camera.get(field, [0, 0, 0])
            if not isinstance(value, list) or len(value) != 3 or any(not isinstance(number, (int, float)) for number in value):
                raise ValueError(f"{label}.{field} 必须是三个数字")
        if not isinstance(camera.get("lens", 50), (int, float)) or not 10 <= camera.get("lens", 50) <= 200:
            raise ValueError(f"{label}.lens 必须在 10–200mm 范围内")
        previous_frame = 0
        for keyframe in camera.get("keyframes", []):
            frame = keyframe.get("frame")
            if not isinstance(frame, int) or not previous_frame < frame <= round(fps * duration):
                raise ValueError(f"{label}.keyframes 必须按帧号严格递增且位于镜头时长内")
            if "location" not in keyframe:
                raise ValueError(f"{label}.keyframes.location 必填")
            previous_frame = frame
            for field in ("location", "target"):
                value = keyframe.get(field, camera.get(field, [0, 0, 0]))
                if not isinstance(value, list) or len(value) != 3 or any(not isinstance(number, (int, float)) for number in value):
                    raise ValueError(f"{label}.keyframes.{field} 必须是三个数字")
            if "lens" in keyframe and (not isinstance(keyframe["lens"], (int, float)) or not 10 <= keyframe["lens"] <= 200):
                raise ValueError(f"{label}.keyframes.lens 必须在 10–200mm 范围内")
    cuts = spec.get("camera_cuts", [])
    if "cameras" in spec:
        if not isinstance(cuts, list) or not cuts or cuts[0].get("frame") != 1:
            raise ValueError("多机位 camera_cuts 必须是非空数组且从第 1 帧开始")
        previous_frame = 0
        protected_frames = {item.get("frame") for item in spec.get("contact_checks", []) if isinstance(item, dict)}
        for cut in cuts:
            if not isinstance(cut, dict) or not isinstance(cut.get("frame"), int) or not previous_frame < cut["frame"] <= round(fps * duration):
                raise ValueError("camera_cuts 必须按帧号严格递增且位于镜头时长内")
            if cut.get("camera") not in camera_names:
                raise ValueError("camera_cuts[].camera 必须引用已声明机位")
            if cut["frame"] != 1 and cut["frame"] in protected_frames:
                raise ValueError(f"camera_cuts 不得在接触帧 {cut['frame']} 切换机位")
            previous_frame = cut["frame"]
    human_names = {item.get("name") for item in spec["objects"] if isinstance(item, dict) and item.get("shape") == "human"}
    for item in spec["objects"]:
        if not isinstance(item, dict) or item.get("shape") not in SHAPES or not isinstance(item.get("name"), str):
            raise ValueError(f"对象必须包含 name，shape 只能是：{', '.join(sorted(SHAPES))}")
        for field in ("location", "scale"):
            value = item.get(field, [0, 0, 0] if field == "location" else [1, 1, 1])
            if not isinstance(value, list) or len(value) != 3 or any(not isinstance(number, (int, float)) for number in value):
                raise ValueError(f"{item['name']}.{field} 必须是三个数字")
        walk = item.get("walk")
        if walk is not None:
            if item["shape"] != "human" or not isinstance(walk, dict):
                raise ValueError(f"{item['name']}.walk 只适用于 human")
            start, end, step, swing = (walk.get(key) for key in ("start_frame", "end_frame", "step_frames", "swing_degrees"))
            phase = walk.get("phase_offset", 0)
            last_frame = round(fps * duration)
            if not all(isinstance(value, int) for value in (start, end, step, phase)) or not 1 <= start < end <= last_frame or not 2 <= step <= 24 or phase not in (0, 1) or not isinstance(swing, (int, float)) or not 0 < swing <= 45:
                raise ValueError(f"{item['name']}.walk 参数无效")
        color = item.get("color")
        if color is not None and (not isinstance(color, list) or len(color) != 3 or any(not isinstance(number, (int, float)) or not 0 <= number <= 1 for number in color)):
            raise ValueError(f"{item['name']}.color 必须是三个 0–1 数字")
        if item["shape"] == "weapon" and item.get("weapon_type") not in WEAPON_TYPES:
            raise ValueError(f"{item['name']}.weapon_type 必须是：{', '.join(sorted(WEAPON_TYPES))}")
        if item["shape"] == "effect" and item.get("effect_type") not in EFFECT_TYPES:
            raise ValueError(f"{item['name']}.effect_type 必须是：{', '.join(sorted(EFFECT_TYPES))}")
        attach = item.get("attach_to")
        if attach is not None:
            if item["shape"] != "weapon" or not isinstance(attach, dict) or attach.get("object") not in human_names or attach.get("bone") not in ("left_hand", "right_hand"):
                raise ValueError(f"{item['name']}.attach_to 只允许把 weapon 绑定到 human 的左右手")
            for field in ("location", "rotation_degrees"):
                value = attach.get(field, [0, 0, 0])
                if not isinstance(value, list) or len(value) != 3 or any(not isinstance(number, (int, float)) for number in value):
                    raise ValueError(f"{item['name']}.attach_to.{field} 必须是三个数字")
        bone_keyframes = item.get("bone_keyframes", [])
        if bone_keyframes and item["shape"] != "human":
            raise ValueError(f"{item['name']}.bone_keyframes 只适用于 human")
        if not isinstance(bone_keyframes, list):
            raise ValueError(f"{item['name']}.bone_keyframes 必须是数组")
        previous_frame = 0
        for keyframe in bone_keyframes:
            if not isinstance(keyframe, dict):
                raise ValueError(f"{item['name']}.bone_keyframes 每项必须是对象")
            frame = keyframe.get("frame")
            rotations = keyframe.get("rotations")
            if not isinstance(frame, int) or not previous_frame < frame <= round(fps * duration):
                raise ValueError(f"{item['name']}.bone_keyframes 必须按帧号严格递增且位于镜头时长内")
            if not isinstance(rotations, dict) or not rotations:
                raise ValueError(f"{item['name']}.bone_keyframes.rotations 必须是非空对象")
            for bone_key, degrees in rotations.items():
                if bone_key not in UE_BONES or not isinstance(degrees, list) or len(degrees) != 3 or any(not isinstance(number, (int, float)) or abs(number) > 180 for number in degrees):
                    raise ValueError(f"{item['name']}.bone_keyframes.{bone_key} 必须是三个 -180–180 度数字")
            previous_frame = frame
        hand_pose_keyframes = item.get("hand_pose_keyframes", [])
        if not isinstance(hand_pose_keyframes, list):
            raise ValueError(f"{item['name']}.hand_pose_keyframes 必须是数组")
        previous_frame = 0
        for keyframe in hand_pose_keyframes:
            if not isinstance(keyframe, dict):
                raise ValueError(f"{item['name']}.hand_pose_keyframes 每项必须是对象")
            frame = keyframe.get("frame")
            if item["shape"] != "human" or not isinstance(frame, int) or not previous_frame < frame <= round(fps * duration):
                raise ValueError(f"{item['name']}.hand_pose_keyframes 必须用于 human、按帧号递增且位于镜头时长内")
            if not any(keyframe.get(side) in ("open", "relaxed", "fist") for side in ("left", "right")):
                raise ValueError(f"{item['name']}.hand_pose_keyframes 必须设置 left 或 right 为 open、relaxed 或 fist")
            if any(side in keyframe and keyframe[side] not in ("open", "relaxed", "fist") for side in ("left", "right")):
                raise ValueError(f"{item['name']}.hand_pose_keyframes 手型无效")
            previous_frame = frame
    object_names = {item["name"] for item in spec["objects"]}
    contact_checks = spec.get("contact_checks", [])
    plant_checks = spec.get("plant_checks", [])
    if not isinstance(contact_checks, list) or not isinstance(plant_checks, list):
        raise ValueError("contact_checks 和 plant_checks 必须是数组")
    for check in contact_checks:
        if not isinstance(check, dict) or not isinstance(check.get("frame"), int) or not 1 <= check["frame"] <= round(fps * duration):
            raise ValueError("contact_checks.frame 必须位于镜头时长内")
        for side in ("a", "b"):
            endpoint = check.get(side)
            if not isinstance(endpoint, dict) or endpoint.get("object") not in object_names:
                raise ValueError(f"contact_checks.{side} 必须引用现有对象")
            if "bone" in endpoint:
                if endpoint["object"] not in human_names or endpoint["bone"] not in UE_BONES or endpoint.get("point", "center") not in ("head", "center", "tail"):
                    raise ValueError(f"contact_checks.{side} 骨骼采样点无效")
            elif endpoint.get("point", "origin") not in ("origin", "mid", "tip"):
                raise ValueError(f"contact_checks.{side} 对象采样点只能是 origin、mid 或 tip")
        if not isinstance(check.get("max_distance"), (int, float)) or not 0 < check["max_distance"] <= 2:
            raise ValueError("contact_checks.max_distance 必须在 0–2 米内")
    for check in plant_checks:
        if not isinstance(check, dict) or check.get("object") not in human_names or check.get("bone") not in ("left_foot", "right_foot"):
            raise ValueError("plant_checks 必须引用 human 的 left_foot 或 right_foot")
        start, end = check.get("start_frame"), check.get("end_frame")
        if not isinstance(start, int) or not isinstance(end, int) or not 1 <= start < end <= round(fps * duration):
            raise ValueError("plant_checks 帧段必须位于镜头时长内")
        if not isinstance(check.get("max_drift"), (int, float)) or not 0 <= check["max_drift"] <= 0.5:
            raise ValueError("plant_checks.max_drift 必须在 0–0.5 米内")
    return spec


def validate_expected_duration(spec, expected):
    if expected is not None and not math.isclose(spec.get("duration_seconds", 3), expected, abs_tol=0.001):
        raise ValueError(f"白模合同与生产计划时长不一致：{spec.get('duration_seconds', 3)} != {expected}")
    return spec


def clear_scene():
    RIGS.clear()
    RIG_BASE_ROTATIONS.clear()
    FINGER_BASE_ROTATIONS.clear()
    SCENE_OBJECTS.clear()
    OBJECT_MARKERS.clear()
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for collection in (bpy.data.materials, bpy.data.cameras, bpy.data.lights):
        for value in list(collection):
            collection.remove(value)


def material(name, color):
    value = bpy.data.materials.new(name)
    value.diffuse_color = (*color, 1)
    value.use_nodes = True
    value.node_tree.nodes.get("Principled BSDF").inputs["Base Color"].default_value = (*color, 1)
    value.node_tree.nodes.get("Principled BSDF").inputs["Roughness"].default_value = 0.82
    return value


def primitive(shape, name, location, scale, white):
    operator = {"cube": bpy.ops.mesh.primitive_cube_add, "cylinder": bpy.ops.mesh.primitive_cylinder_add, "sphere": bpy.ops.mesh.primitive_uv_sphere_add}[shape]
    operator(location=location)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    obj.data.materials.append(white)
    return obj


def child_primitive(root, shape, name, location, scale, value, rotation=None):
    obj = primitive(shape, name, location, scale, value)
    obj.parent = root
    if rotation:
        obj.rotation_euler = [math.radians(number) for number in rotation]
    return obj


def weapon(item, value):
    root = bpy.data.objects.new(item["name"], None)
    bpy.context.collection.objects.link(root)
    root.location = item.get("location", [0, 0, 0])
    root.scale = item.get("scale", [1, 1, 1])
    kind = item["weapon_type"]
    metal = material(f"{item['name']}-刃材质", (0.62, 0.68, 0.76))
    dark = material(f"{item['name']}-柄材质", (0.10, 0.08, 0.06))
    tip_z = 1.65
    if kind in ("sword", "dao"):
        child_primitive(root, "cylinder", f"{item['name']}-柄", [0, 0, 0.22], [0.055, 0.055, 0.28], dark)
        child_primitive(root, "cube", f"{item['name']}-护手", [0, 0, 0.52], [0.22, 0.055, 0.045], value)
        child_primitive(root, "cube", f"{item['name']}-刃", [0, 0, 1.08], [0.055 if kind == "sword" else 0.09, 0.025, 0.55], metal, [0, 0, -8 if kind == "dao" else 0])
    elif kind in ("spear", "staff"):
        tip_z = 2.15
        child_primitive(root, "cylinder", f"{item['name']}-杆", [0, 0, 1.05], [0.045, 0.045, 1.05], dark if kind == "spear" else value)
        if kind == "spear":
            bpy.ops.mesh.primitive_cone_add(vertices=12, radius1=0.10, radius2=0, depth=0.38, location=(0, 0, 2.27))
            bpy.context.object.name = f"{item['name']}-枪头"
            bpy.context.object.parent = root
            bpy.context.object.data.materials.append(metal)
            tip_z = 2.46
    else:
        tip_z = 0.62
        child_primitive(root, "cylinder", f"{item['name']}-盾面", [0, 0, 0.62], [0.52, 0.52, 0.10], value, [90, 0, 0])
        child_primitive(root, "cube", f"{item['name']}-握把", [0, 0.12, 0.62], [0.05, 0.12, 0.20], dark)
    OBJECT_MARKERS[item["name"]] = {}
    for point, z in (("mid", tip_z * 0.62), ("tip", tip_z)):
        marker = bpy.data.objects.new(f"{item['name']}-{point}", None)
        bpy.context.collection.objects.link(marker)
        marker.parent = root
        marker.location = [0, 0, z]
        OBJECT_MARKERS[item["name"]][point] = marker
    return root


def effect(item, value):
    root = bpy.data.objects.new(item["name"], None)
    bpy.context.collection.objects.link(root)
    root.location = item.get("location", [0, 0, 0])
    root.scale = item.get("scale", [1, 1, 1])
    glow = material(f"{item['name']}-发光材质", tuple(item.get("color", [0.25, 0.65, 1.0])))
    bsdf = glow.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Emission Color"].default_value = (*item.get("color", [0.25, 0.65, 1.0]), 1)
    bsdf.inputs["Emission Strength"].default_value = item.get("emission", 5)
    kind = item["effect_type"]
    if kind == "orb":
        child_primitive(root, "sphere", f"{item['name']}-核心", [0, 0, 0], [0.28, 0.28, 0.28], glow)
        for index in range(8):
            angle = math.tau * index / 8
            child_primitive(root, "sphere", f"{item['name']}-粒子{index + 1}", [0.48 * math.cos(angle), 0.48 * math.sin(angle), 0.12 * (-1) ** index], [0.055, 0.055, 0.055], glow)
    elif kind == "beam":
        child_primitive(root, "cylinder", f"{item['name']}-光束", [0, 0, 1.4], [0.12, 0.12, 1.4], glow)
        child_primitive(root, "sphere", f"{item['name']}-束首", [0, 0, 2.8], [0.20, 0.20, 0.20], glow)
    elif kind == "ring":
        bpy.ops.mesh.primitive_torus_add(major_radius=0.75, minor_radius=0.055, location=(0, 0, 0))
        bpy.context.object.name = f"{item['name']}-冲击环"
        bpy.context.object.parent = root
        bpy.context.object.data.materials.append(glow)
    else:
        child_primitive(root, "sphere", f"{item['name']}-爆心", [0, 0, 0], [0.20, 0.20, 0.20], glow)
        for index in range(12):
            angle = math.tau * index / 12
            child_primitive(root, "cube", f"{item['name']}-射线{index + 1}", [0.55 * math.cos(angle), 0.55 * math.sin(angle), 0], [0.28, 0.035, 0.035], glow, [0, 0, math.degrees(angle)])
    return root


def mannequin(item, white, model_path):
    before = set(bpy.context.scene.objects)
    bpy.ops.import_scene.gltf(filepath=str(model_path))
    imported = set(bpy.context.scene.objects) - before
    armature = next((obj for obj in imported if obj.type == "ARMATURE"), None)
    if not armature or any(name not in armature.pose.bones for name in UE_BONES.values()):
        raise ValueError(f"{model_path} 不是受支持的 UE Mannequin 骨架")

    root = bpy.data.objects.new(item["name"], None)
    bpy.context.collection.objects.link(root)
    for obj in imported:
        obj.name = f"{item['name']}-{obj.name}"
        if obj.parent is None:
            obj.parent = root
        if obj.type == "MESH":
            obj.data.materials.clear()
            obj.data.materials.append(white)
    root.location = item.get("location", [0, 0, 0])
    root.scale = [value * 1.35 for value in item.get("scale", [1, 1, 1])]
    root.rotation_euler[2] = math.radians(item.get("heading_degrees", 0))
    RIGS[item["name"]] = armature

    neutral = {
        "left_arm": [0, 25, 0],
        "right_arm": [0, -25, 0],
        "left_forearm": [0, 0, 25],
        "right_forearm": [0, 0, 25],
    }
    for key, degrees in neutral.items():
        bone = armature.pose.bones[UE_BONES[key]]
        bone.rotation_mode = "XYZ"
        bone.rotation_euler = [math.radians(value) for value in degrees]
    RIG_BASE_ROTATIONS[item["name"]] = {}
    for key, name in UE_BONES.items():
        bone = armature.pose.bones[name]
        bone.rotation_mode = "XYZ"
        RIG_BASE_ROTATIONS[item["name"]][key] = tuple(bone.rotation_euler)
    FINGER_BASE_ROTATIONS[item["name"]] = {}
    for name in FINGER_BONES["left"] + FINGER_BONES["right"]:
        bone = armature.pose.bones[name]
        bone.rotation_mode = "XYZ"
        FINGER_BASE_ROTATIONS[item["name"]][name] = tuple(bone.rotation_euler)
    return root


def human(item, white, model_path=None):
    if model_path:
        return mannequin(item, white, model_path)
    root = bpy.data.objects.new(item["name"], None)
    bpy.context.collection.objects.link(root)
    root.location = item.get("location", [0, 0, 0])
    root.scale = item.get("scale", [1, 1, 1])
    root.rotation_euler[2] = math.radians(item.get("heading_degrees", 0))
    dark = material(f"{item['name']}-方向标记材质", (0.06, 0.07, 0.09))
    accent = material(f"{item['name']}-服装层次材质", tuple(max(0.08, channel * 0.72) for channel in white.diffuse_color[:3]))

    def part(shape, label, location, scale, value=white, parent=root):
        obj = primitive(shape, f"{item['name']}-{label}", location, scale, value)
        obj.parent = parent
        return obj

    part("cylinder", "胸腔", [0, 0, 1.42], [0.34, 0.3, 0.48])
    part("cube", "肩线", [0, 0, 1.72], [0.55, 0.28, 0.13], accent)
    part("cylinder", "颈部", [0, 0, 1.9], [0.15, 0.15, 0.2], accent)
    part("cube", "骨盆", [0, 0, 0.98], [0.34, 0.3, 0.18], accent)
    part("cylinder", "衣摆", [0, 0, 0.67], [0.42, 0.36, 0.34], accent)
    head_control = bpy.data.objects.new(f"{item['name']}-头部控制", None)
    bpy.context.collection.objects.link(head_control)
    head_control.location = [0, 0, 2.2]
    head_control.parent = root
    part("sphere", "头部", [0, 0, 0], [0.36, 0.34, 0.4], white, head_control)
    part("sphere", "面部平面", [0, -0.31, -0.01], [0.29, 0.08, 0.31], white, head_control)
    part("sphere", "左眼", [-0.12, -0.385, 0.08], [0.045, 0.028, 0.055], dark, head_control)
    part("sphere", "右眼", [0.12, -0.385, 0.08], [0.045, 0.028, 0.055], dark, head_control)
    part("cube", "鼻向", [0, -0.405, -0.01], [0.035, 0.055, 0.07], accent, head_control)
    part("cube", "口线", [0, -0.385, -0.15], [0.12, 0.025, 0.025], dark, head_control)
    part("cylinder", "发冠", [0, 0, 0.43], [0.12, 0.12, 0.12], accent, head_control)

    def arm(label, hand_label, x):
        control = bpy.data.objects.new(f"{item['name']}-{label}控制", None)
        bpy.context.collection.objects.link(control)
        control.location = [x, 0, 1.66]
        control.parent = root
        part("cylinder", f"{label}上臂", [0, 0, -0.27], [0.15, 0.15, 0.27], accent, control)
        part("sphere", f"{label}肘", [0, 0, -0.55], [0.16, 0.16, 0.16], white, control)
        part("cylinder", f"{label}前臂", [0, 0, -0.82], [0.125, 0.125, 0.27], white, control)
        part("cube", hand_label, [0, -0.035, -1.13], [0.18, 0.1, 0.2], accent, control)
        return control

    for side, x in (("左", -0.2), ("右", 0.2)):
        control = bpy.data.objects.new(f"{item['name']}-{side}腿控制", None)
        bpy.context.collection.objects.link(control)
        control.location = [x, 0, 0.82]
        control.parent = root
        part("cylinder", f"{side}大腿", [0, 0, -0.2], [0.16, 0.16, 0.22], accent, control)
        part("sphere", f"{side}膝", [0, 0, -0.43], [0.15, 0.15, 0.15], white, control)
        part("cylinder", f"{side}小腿", [0, 0, -0.62], [0.13, 0.13, 0.2], white, control)
        part("cube", f"{side}足", [0, -0.13, -0.8], [0.15, 0.28, 0.09], accent, control)
    if item.get("pose") == "block":
        arm_control = arm("横臂", "左手", -0.5)
        arm_control.rotation_euler = [math.radians(number) for number in item.get("arm_rotation_degrees", [-90, 0, 0])]
        arm("右臂", "右手", 0.5)
    else:
        arm("左臂", "左手", -0.5)
        arm("右臂", "右手", 0.5)
    return root


def animate_walk(item, last_frame):
    walk = item.get("walk")
    if not walk:
        return
    rig = RIGS.get(item["name"])
    left = rig.pose.bones[UE_BONES["left_leg"]] if rig else bpy.data.objects[f"{item['name']}-左腿控制"]
    right = rig.pose.bones[UE_BONES["right_leg"]] if rig else bpy.data.objects[f"{item['name']}-右腿控制"]
    start, end = walk["start_frame"], walk["end_frame"]
    frames = [(start, 0)]
    phase = walk.get("phase_offset", 0)
    frames.extend((frame, walk["swing_degrees"] * (-1 if (index + phase) % 2 else 1)) for index, frame in enumerate(range(start + walk["step_frames"], end, walk["step_frames"])))
    frames.append((end, 0))
    for frame, angle in frames:
        for control, value in ((left, angle), (right, -angle)):
            control.rotation_mode = "XYZ"
            control.rotation_euler = [0, 0, math.radians(value)] if rig else [math.radians(value), 0, 0]
            control.keyframe_insert(data_path="rotation_euler", frame=frame)
        left_arm = rig.pose.bones[UE_BONES["left_arm"]] if rig else bpy.data.objects.get(f"{item['name']}-左臂控制")
        right_arm = rig.pose.bones[UE_BONES["right_arm"]] if rig else bpy.data.objects.get(f"{item['name']}-右臂控制")
        for control, value in ((left_arm, -angle * 0.65), (right_arm, angle * 0.65)):
            if control:
                control.rotation_mode = "XYZ"
                control.rotation_euler = [0, math.radians(25 if control == left_arm else -25), math.radians(value)] if rig else [math.radians(value), 0, 0]
                control.keyframe_insert(data_path="rotation_euler", frame=frame)


def animate_mannequin_pose(item, last_frame):
    rig = RIGS[item["name"]]
    for keyframe in item.get("head_keyframes", []):
        frame = keyframe["frame"]
        if not 1 <= frame <= last_frame:
            raise ValueError(f"{item['name']} 的头部关键帧超出有效范围")
        bone = rig.pose.bones[UE_BONES["head"]]
        bone.rotation_mode = "XYZ"
        bone.rotation_euler = [math.radians(value) for value in keyframe["rotation_degrees"]]
        bone.keyframe_insert(data_path="rotation_euler", frame=frame)
    for keyframe in item.get("arm_keyframes", []):
        frame = keyframe["frame"]
        if not 1 <= frame <= last_frame:
            raise ValueError(f"{item['name']} 的手臂关键帧超出有效范围")
        x, y, z = keyframe["rotation_degrees"]
        bone = rig.pose.bones[UE_BONES["left_arm"]]
        bone.rotation_mode = "XYZ"
        bone.rotation_euler = [math.radians(z), math.radians(25 + y), math.radians(x)]
        bone.keyframe_insert(data_path="rotation_euler", frame=frame)
    for keyframe in item.get("bone_keyframes", []):
        frame = keyframe["frame"]
        for bone_key, degrees in keyframe["rotations"].items():
            bone = rig.pose.bones[UE_BONES[bone_key]]
            bone.rotation_mode = "XYZ"
            baseline = RIG_BASE_ROTATIONS[item["name"]][bone_key]
            bone.rotation_euler = [baseline[index] + math.radians(value) for index, value in enumerate(degrees)]
            bone.keyframe_insert(data_path="rotation_euler", frame=frame)
    curls = {"open": 0, "relaxed": 28, "fist": 68}
    for keyframe in item.get("hand_pose_keyframes", []):
        for side in ("left", "right"):
            if side not in keyframe:
                continue
            curl = curls[keyframe[side]] * (1 if side == "left" else -1)
            for index, name in enumerate(FINGER_BONES[side]):
                bone = rig.pose.bones[name]
                baseline = FINGER_BASE_ROTATIONS[item["name"]][name]
                bone.rotation_euler = [baseline[0], baseline[1], baseline[2] + math.radians(curl * (0.55 if index % 3 == 0 else 1))]
                bone.keyframe_insert(data_path="rotation_euler", frame=keyframe["frame"])


def evaluated_bone_point(actor, bone_key, point, depsgraph):
    rig = RIGS[actor].evaluated_get(depsgraph)
    bone = rig.pose.bones[UE_BONES[bone_key]]
    local = bone.head if point == "head" else bone.tail if point == "tail" else (bone.head + bone.tail) * 0.5
    return rig.matrix_world @ local


def evaluated_endpoint(endpoint, depsgraph):
    if "bone" in endpoint:
        return evaluated_bone_point(endpoint["object"], endpoint["bone"], endpoint.get("point", "center"), depsgraph)
    point = endpoint.get("point", "origin")
    obj = OBJECT_MARKERS[endpoint["object"]][point] if point in ("mid", "tip") else SCENE_OBJECTS[endpoint["object"]]
    return obj.evaluated_get(depsgraph).matrix_world.translation


def validate_action_physics(spec, scene):
    depsgraph = bpy.context.evaluated_depsgraph_get()
    for check in spec.get("contact_checks", []):
        scene.frame_set(check["frame"])
        depsgraph.update()
        a = check["a"]
        b = check["b"]
        a_point = evaluated_endpoint(a, depsgraph)
        b_point = evaluated_endpoint(b, depsgraph)
        distance = (a_point - b_point).length
        if distance > check["max_distance"]:
            a_label = f"{a['object']}.{a.get('bone', a.get('point', 'origin'))}"
            b_label = f"{b['object']}.{b.get('bone', b.get('point', 'origin'))}"
            raise ValueError(f"第 {check['frame']} 帧接触失败：{a_label} {tuple(round(value, 3) for value in a_point)} 与 {b_label} {tuple(round(value, 3) for value in b_point)} 相距 {distance:.3f} 米")
    for check in spec.get("plant_checks", []):
        scene.frame_set(check["start_frame"])
        depsgraph.update()
        origin = evaluated_bone_point(check["object"], check["bone"], "center", depsgraph)
        maximum = 0.0
        for frame in range(check["start_frame"] + 1, check["end_frame"] + 1):
            scene.frame_set(frame)
            depsgraph.update()
            point = evaluated_bone_point(check["object"], check["bone"], "center", depsgraph)
            maximum = max(maximum, (Vector((point.x, point.y)) - Vector((origin.x, origin.y))).length)
        if maximum > check["max_drift"]:
            raise ValueError(f"第 {check['start_frame']}–{check['end_frame']} 帧支撑脚滑动：{check['object']}.{check['bone']} 漂移 {maximum:.3f} 米")
    scene.frame_set(scene.frame_start)


def animate(obj, item, last_frame):
    for keyframe in item.get("keyframes", []):
        frame = keyframe.get("frame")
        if not isinstance(frame, int) or not 1 <= frame <= last_frame:
            raise ValueError(f"{item['name']} 的关键帧超出有效范围")
        for field in ("location", "rotation_degrees", "scale"):
            if field not in keyframe:
                continue
            value = keyframe[field]
            if not isinstance(value, list) or len(value) != 3:
                raise ValueError(f"{item['name']} 的 {field} 必须是三个数字")
            attr = "rotation_euler" if field == "rotation_degrees" else field
            setattr(obj, attr, [math.radians(number) for number in value] if field == "rotation_degrees" else value)
            obj.keyframe_insert(data_path=attr, frame=frame)


def point_at(obj, target):
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat("-Z", "Y").to_euler()


def attach_weapon(item, obj):
    attach = item.get("attach_to")
    if not attach:
        return
    rig = RIGS[attach["object"]]
    obj.parent = rig
    obj.parent_type = "BONE"
    obj.parent_bone = UE_BONES[attach["bone"]]
    obj.location = attach.get("location", [0, 0, 0])
    obj.rotation_euler = [math.radians(number) for number in attach.get("rotation_degrees", [0, 0, 0])]
    obj.scale = [1, 1, 1]
    bpy.context.view_layer.update()
    inherited_scale = obj.matrix_world.to_scale()
    requested_scale = item.get("scale", [1, 1, 1])
    obj.scale = [requested_scale[index] / inherited_scale[index] for index in range(3)]


def build(spec, output, blend_output=None, mannequin_model=None):
    clear_scene()
    if mannequin_model and not mannequin_model.is_file():
        raise ValueError(f"找不到 mannequin 模型：{mannequin_model}")
    scene = bpy.context.scene
    scene.frame_start = 1
    scene.frame_end = round(spec.get("fps", 12) * spec.get("duration_seconds", 3))
    scene.render.fps = spec.get("fps", 12)
    scene.render.resolution_x, scene.render.resolution_y = spec.get("resolution", [640, 360])
    scene.render.resolution_percentage = 100
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.image_settings.file_format = "PNG"
    scene.world.color = (0.04, 0.04, 0.04)
    if any(item["shape"] == "effect" for item in spec["objects"]):
        if hasattr(scene, "compositing_node_group"):
            tree = bpy.data.node_groups.new("白模术法辉光", "CompositorNodeTree")
            scene.compositing_node_group = tree
            tree.interface.new_socket(name="Image", in_out="OUTPUT", socket_type="NodeSocketColor")
            compositor_output = tree.nodes.new("NodeGroupOutput")
        else:
            scene.use_nodes = True
            tree = scene.node_tree
            tree.nodes.clear()
            compositor_output = tree.nodes.new("CompositorNodeComposite")
        nodes = tree.nodes
        links = tree.links
        render_layers = nodes.new("CompositorNodeRLayers")
        glare = nodes.new("CompositorNodeGlare")
        if bpy.app.version >= (5, 0, 0):
            glare.inputs["Type"].default_value = "Fog Glow"
            glare.inputs["Quality"].default_value = "Low"
            glare.inputs["Threshold"].default_value = 0.7
        else:
            glare.glare_type = "FOG_GLOW"
            glare.quality = "LOW"
            glare.threshold = 0.7
        links.new(render_layers.outputs["Image"], glare.inputs["Image"])
        links.new(glare.outputs["Image"], compositor_output.inputs["Image"])

    white = material("白模材质", (0.72, 0.74, 0.78))
    floor_material = material("地面材质", (0.16, 0.18, 0.22))
    bpy.ops.mesh.primitive_plane_add(size=30, location=(0, 0, 0))
    bpy.context.object.data.materials.append(floor_material)

    built = []
    for item in spec["objects"]:
        object_material = material(f"{item['name']}-材质", item["color"]) if item.get("color") else white
        if item["shape"] == "human":
            obj = human(item, object_material, mannequin_model)
        elif item["shape"] == "weapon":
            obj = weapon(item, object_material)
        elif item["shape"] == "effect":
            obj = effect(item, object_material)
        else:
            obj = primitive(item["shape"], item["name"], item.get("location", [0, 0, 0]), item.get("scale", [1, 1, 1]), object_material)
        SCENE_OBJECTS[item["name"]] = obj
        built.append((item, obj))

    for item, obj in built:
        attach_weapon(item, obj)
        animate(obj, item, scene.frame_end)
        animate_walk(item, scene.frame_end)
        if item["name"] in RIGS:
            animate_mannequin_pose(item, scene.frame_end)
        elif item.get("arm_keyframes"):
            animate(bpy.data.objects[f"{item['name']}-横臂控制"], {"name": f"{item['name']}横臂", "keyframes": item["arm_keyframes"]}, scene.frame_end)
        if item.get("head_keyframes") and item["name"] not in RIGS:
            animate(bpy.data.objects[f"{item['name']}-头部控制"], {"name": f"{item['name']}头部", "keyframes": item["head_keyframes"]}, scene.frame_end)

    validate_action_physics(spec, scene)

    camera_specs = spec.get("cameras", [spec.get("camera", {})])
    cameras = {}
    for index, camera_spec in enumerate(camera_specs):
        camera_name = camera_spec.get("name", "主相机" if len(camera_specs) == 1 else f"机位{index + 1}")
        camera_data = bpy.data.cameras.new(camera_name)
        camera = bpy.data.objects.new(camera_name, camera_data)
        bpy.context.collection.objects.link(camera)
        camera.location = camera_spec.get("location", [8, -11, 6])
        camera.data.lens = camera_spec.get("lens", 50)
        target = camera_spec.get("target", [0, 0, 1.2])
        point_at(camera, target)
        for keyframe in camera_spec.get("keyframes", []):
            camera.location = keyframe["location"]
            point_at(camera, keyframe.get("target", target))
            if "lens" in keyframe:
                camera.data.lens = keyframe["lens"]
                camera.data.keyframe_insert(data_path="lens", frame=keyframe["frame"])
            camera.keyframe_insert(data_path="location", frame=keyframe["frame"])
            camera.keyframe_insert(data_path="rotation_euler", frame=keyframe["frame"])
        cameras[camera_name] = camera
    if "cameras" in spec:
        # 时间线摄影机标记让切换发生在准确帧位，避免用高速摇移伪装正反打。
        for cut in spec["camera_cuts"]:
            marker = scene.timeline_markers.new(f"切至-{cut['camera']}", frame=cut["frame"])
            marker.camera = cameras[cut["camera"]]
        scene.camera = cameras[spec["camera_cuts"][0]["camera"]]
    else:
        scene.camera = next(iter(cameras.values()))

    for name, light_type, energy, location in (("主光", "AREA", 1100, (2, -4, 8)), ("轮廓光", "AREA", 700, (-6, 1, 5))):
        data = bpy.data.lights.new(name, light_type)
        data.energy = energy
        data.shape = "DISK"
        data.size = 5
        light = bpy.data.objects.new(name, data)
        light.location = location
        point_at(light, (0, 0, 1))
        bpy.context.collection.objects.link(light)

    output.parent.mkdir(parents=True, exist_ok=True)
    if blend_output:
        blend_output.parent.mkdir(parents=True, exist_ok=True)
        bpy.ops.wm.save_as_mainfile(filepath=str(blend_output))
    with tempfile.TemporaryDirectory(prefix="short-drama-previz-") as temporary:
        scene.render.filepath = str(Path(temporary) / "frame_")
        bpy.ops.render.render(animation=True)
        subprocess.run([
            "ffmpeg", "-loglevel", "error", "-y", "-framerate", str(scene.render.fps),
            "-i", str(Path(temporary) / "frame_%04d.png"), "-c:v", "libx264",
            "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(output),
        ], check=True)


def main():
    args = arguments()
    if args.self_check:
        if not DEFAULT_MANNEQUIN_MODEL.is_file():
            raise ValueError(f"缺少默认 UE Mannequin 模型：{DEFAULT_MANNEQUIN_MODEL}")
        validate(demo_spec())
        validate_expected_duration(demo_spec(), 3)
        try:
            validate_expected_duration(demo_spec(), 8)
            raise AssertionError("时长不一致仍通过自检")
        except ValueError:
            pass
        action_demo = demo_spec()
        action_demo["objects"][0]["bone_keyframes"] = [{"frame": 12, "rotations": {"left_arm": [0, 25, -70], "left_forearm": [0, 0, 80]}}]
        action_demo["objects"][0]["hand_pose_keyframes"] = [{"frame": 1, "left": "fist", "right": "relaxed"}]
        action_demo["contact_checks"] = [{"frame": 12, "a": {"object": "人物A", "bone": "left_hand"}, "b": {"object": "人物B", "bone": "right_forearm"}, "max_distance": 2}]
        action_demo["plant_checks"] = [{"object": "人物B", "bone": "right_foot", "start_frame": 1, "end_frame": 12, "max_drift": 0.5}]
        validate(action_demo)
        preset_demo = demo_spec()
        preset_demo["objects"].extend(
            [{"name": f"测试-{kind}", "shape": "weapon", "weapon_type": kind, "attach_to": {"object": "人物A", "bone": "right_hand"}} for kind in sorted(WEAPON_TYPES)]
            + [{"name": f"测试-{kind}", "shape": "effect", "effect_type": kind, "location": [0, 0, 1.5], "color": [0.2, 0.6, 1.0]} for kind in sorted(EFFECT_TYPES)]
        )
        preset_demo["contact_checks"] = [{"frame": 12, "a": {"object": "测试-sword", "point": "mid"}, "b": {"object": "人物B", "bone": "right_forearm"}, "max_distance": 2}]
        validate(preset_demo)
        print("ok")
        return
    if not args.output or (not args.demo and not args.spec):
        raise SystemExit("必须提供 --output，并使用 --demo 或 --spec")
    spec = validate_expected_duration(demo_spec() if args.demo else json.loads(args.spec.read_text(encoding="utf-8")), args.expected_duration)
    build(validate(spec), args.output.resolve(), args.blend_output.resolve() if args.blend_output else None, args.mannequin_model.resolve() if args.mannequin_model else None)
    print(args.output.resolve())


if __name__ == "__main__":
    main()
