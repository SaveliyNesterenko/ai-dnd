let activeDrag = null;

export function makeDraggable(element) {
    element.addEventListener('mousedown', (e) => { 
        e.preventDefault(); 
        activeDrag = { 
            element, 
            offsetX: e.clientX - element.getBoundingClientRect().left, 
            offsetY: e.clientY - element.getBoundingClientRect().top 
        }; 
        element.classList.add('dragging'); 
    });
}

document.addEventListener('mousemove', (e) => { 
    if (!activeDrag) return; 
    e.preventDefault(); 
    activeDrag.element.style.left = `${e.clientX - activeDrag.offsetX}px`; 
    activeDrag.element.style.top = `${e.clientY - activeDrag.offsetY}px`; 
});

document.addEventListener('mouseup', () => { 
    if (activeDrag) { 
        activeDrag.element.classList.remove('dragging'); 
        activeDrag = null; 
    } 
});
