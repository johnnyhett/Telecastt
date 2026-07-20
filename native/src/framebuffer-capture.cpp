#include <d3d11.h>
#include <dxgi1_2.h>
#include <iostream>
#include <vector>

class FramebufferCapture {
private:
    ID3D11Device* d3dDevice = nullptr;
    ID3D11DeviceContext* d3dContext = nullptr;
    IDXGIOutputDuplication* deskDupl = nullptr;
    
    // Concept #48: Pre-allocated ring buffer for frame storage
    struct FrameBuffer {
        std::vector<uint8_t> data;
        bool ready;
    };
    std::vector<FrameBuffer> ringBuffer;
    int currentBufferIndex = 0;

public:
    FramebufferCapture() {
        ringBuffer.resize(3);
        for(auto& buf : ringBuffer) {
            buf.data.resize(1920 * 1080 * 4);
            buf.ready = false;
        }
    }

    bool Initialize() {
        D3D_FEATURE_LEVEL featureLevel;
        HRESULT hr = D3D11CreateDevice(
            nullptr, D3D_DRIVER_TYPE_HARDWARE, nullptr, 0,
            nullptr, 0, D3D11_SDK_VERSION, &d3dDevice,
            &featureLevel, &d3dContext);

        if (FAILED(hr)) return false;

        IDXGIDevice* dxgiDevice = nullptr;
        hr = d3dDevice->QueryInterface(__uuidof(IDXGIDevice), (void**)&dxgiDevice);
        if (FAILED(hr)) return false;

        IDXGIAdapter* dxgiAdapter = nullptr;
        hr = dxgiDevice->GetParent(__uuidof(IDXGIAdapter), (void**)&dxgiAdapter);
        dxgiDevice->Release();
        if (FAILED(hr)) return false;

        IDXGIOutput* dxgiOutput = nullptr;
        hr = dxgiAdapter->EnumOutputs(0, &dxgiOutput);
        dxgiAdapter->Release();
        if (FAILED(hr)) return false;

        IDXGIOutput1* dxgiOutput1 = nullptr;
        hr = dxgiOutput->QueryInterface(__uuidof(IDXGIOutput1), (void**)&dxgiOutput1);
        dxgiOutput->Release();
        if (FAILED(hr)) return false;

        hr = dxgiOutput1->DuplicateOutput(d3dDevice, &deskDupl);
        dxgiOutput1->Release();
        if (FAILED(hr)) return false;

        return true;
    }

    bool CaptureFrame() {
        if (!deskDupl) return false;

        DXGI_OUTDUPL_FRAME_INFO frameInfo;
        IDXGIResource* desktopResource = nullptr;
        
        HRESULT hr = deskDupl->AcquireNextFrame(500, &frameInfo, &desktopResource);
        if (FAILED(hr)) return false;

        ID3D11Texture2D* acquiredDesktopImage = nullptr;
        hr = desktopResource->QueryInterface(__uuidof(ID3D11Texture2D), (void**)&acquiredDesktopImage);
        desktopResource->Release();
        
        if (FAILED(hr)) {
            deskDupl->ReleaseFrame();
            return false;
        }

        // Concept #39: NVENC encoding would plug in here
        
        // Dummy data storage
        auto& buf = ringBuffer[currentBufferIndex];
        buf.ready = true;
        currentBufferIndex = (currentBufferIndex + 1) % ringBuffer.size();

        acquiredDesktopImage->Release();
        deskDupl->ReleaseFrame();
        return true;
    }

    ~FramebufferCapture() {
        if (deskDupl) deskDupl->Release();
        if (d3dContext) d3dContext->Release();
        if (d3dDevice) d3dDevice->Release();
    }
};
