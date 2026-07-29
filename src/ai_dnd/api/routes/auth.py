from fastapi import APIRouter, HTTPException, Query, Response, status
from fastapi.responses import RedirectResponse

from ai_dnd.api.dependencies import GMDep, SecurityDep

router = APIRouter(prefix="/auth", tags=["authentication"])


@router.get("/gm/bootstrap", include_in_schema=False)
async def bootstrap_gm(
    security_manager: SecurityDep,
    token: str = Query(min_length=20, max_length=200),
) -> Response:
    if not security_manager.consume_bootstrap(token):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token.")
    response = RedirectResponse("/gm", status_code=status.HTTP_303_SEE_OTHER)
    response.set_cookie(
        "ai_dnd_gm",
        security_manager.issue_gm_session(),
        httponly=True,
        samesite="strict",
        secure=False,
        max_age=12 * 60 * 60,
        path="/",
    )
    return response


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout() -> Response:
    response = Response(status_code=status.HTTP_204_NO_CONTENT)
    response.delete_cookie("ai_dnd_gm", path="/")
    return response


@router.get("/session")
async def session_info(security_manager: SecurityDep, gm: GMDep) -> dict[str, str]:
    del gm
    return {
        "role": "gm",
        "spectator_code": security_manager.spectator_code,
    }
