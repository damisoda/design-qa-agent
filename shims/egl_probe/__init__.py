"""macOS용 대체 모듈. robomimic은 오프스크린 렌더링 시 egl_probe(리눅스 EGL 전용)를 import한다.
macOS에서는 robosuite가 MUJOCO_GL=cgl을 쓰므로 GPU 장치 선택이 필요 없어 빈 목록을 돌려준다.
영상 생성 때만 PYTHONPATH로 넣는다(설치 환경에는 넣지 않음)."""


def get_available_devices():
    return []
